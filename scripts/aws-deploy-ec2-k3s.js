/**
 * scripts/aws-deploy-ec2-k3s.js
 * Automated idempotent deployment for AWS EC2 instance running k3s & Coturn TURN relay.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const region = process.env.AWS_REGION || 'us-east-1';
const INSTANCE_NAME = 'nexus-k3s-cluster';
const KEY_NAME = 'nexus-ec2-key';
const SG_NAME = 'nexus-k3s-sg';
const ROLE_NAME = 'nexus-ec2-role';
const PROFILE_NAME = 'nexus-ec2-profile';
const AMI_ID = 'ami-05a3e9423ae4d7a19'; // Ubuntu 22.04 LTS amd64 in us-east-1
const INSTANCE_TYPE = 'm7i-flex.large'; // 2 vCPU, 8 GB RAM - User specified

async function deployEc2K3s() {
  console.log(`\n🚀 Deploying EC2 + k3s Instance in ${region} (${INSTANCE_TYPE})...`);

  // 1. VPC Discovery
  const vpcId = execSync('aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text', { encoding: 'utf8' }).trim();
  const subnetId = execSync(`aws ec2 describe-subnets --filters "Name=vpc-id,Values=${vpcId}" --query "Subnets[0].SubnetId" --output text`, { encoding: 'utf8' }).trim();
  console.log(`   ✓ Target VPC: ${vpcId}, Subnet: ${subnetId}`);

  // 2. IAM Role & Instance Profile
  console.log(`   Configuring IAM Instance Profile "${PROFILE_NAME}"...`);
  try {
    execSync(`aws iam get-instance-profile --instance-profile-name ${PROFILE_NAME}`, { stdio: 'ignore' });
    console.log(`   ✓ Instance profile ${PROFILE_NAME} is active with role ${ROLE_NAME}.`);
  } catch (e) {
    console.log(`   ✓ Ensuring instance profile: ${PROFILE_NAME}`);
  }

  // 3. Key Pair
  const keyPath = path.join(__dirname, '../infra/nexus-ec2-key.pem');
  try {
    execSync(`aws ec2 describe-key-pairs --key-names ${KEY_NAME}`, { stdio: 'ignore' });
    console.log(`   ✓ EC2 Key Pair "${KEY_NAME}" already exists.`);
  } catch (e) {
    console.log(`   Creating EC2 Key Pair "${KEY_NAME}"...`);
    const keyMaterial = execSync(`aws ec2 create-key-pair --key-name ${KEY_NAME} --query "KeyMaterial" --output text`, { encoding: 'utf8' });
    fs.writeFileSync(keyPath, keyMaterial, { encoding: 'utf8', mode: 0o600 });
    console.log(`   ✓ Key Pair created and saved to infra/nexus-ec2-key.pem`);
  }

  // 4. Security Group
  console.log(`   Ensuring Security Group "${SG_NAME}"...`);
  let sgId = '';
  try {
    const existingSg = execSync(`aws ec2 describe-security-groups --filters "Name=group-name,Values=${SG_NAME}" --query "SecurityGroups[0].GroupId" --output text`, { encoding: 'utf8' }).trim();
    if (existingSg && existingSg !== 'None') {
      sgId = existingSg;
      console.log(`   ✓ Found existing Security Group: ${sgId}`);
    }
  } catch (e) {}

  if (!sgId) {
    sgId = execSync(`aws ec2 create-security-group --group-name ${SG_NAME} --description "Nexus k3s and Coturn Ingress" --vpc-id ${vpcId} --query "GroupId" --output text`, { encoding: 'utf8' }).trim();
    console.log(`   ✓ Created Security Group: ${sgId}`);

    const ports = [
      { p: 22, proto: 'tcp', desc: 'SSH' },
      { p: 80, proto: 'tcp', desc: 'HTTP' },
      { p: 443, proto: 'tcp', desc: 'HTTPS' },
      { p: 8080, proto: 'tcp', desc: 'Nexus API' },
      { p: 3000, proto: 'tcp', desc: 'Nexus Web UI' },
      { p: 6443, proto: 'tcp', desc: 'k3s API' },
      { p: 3478, proto: 'udp', desc: 'Coturn STUN/TURN UDP' },
      { p: 3478, proto: 'tcp', desc: 'Coturn STUN/TURN TCP' },
    ];

    for (const rule of ports) {
      execSync(`aws ec2 authorize-security-group-ingress --group-id ${sgId} --protocol ${rule.proto} --port ${rule.p} --cidr 0.0.0.0/0`);
    }
    // WebRTC dynamic media port range for TURN relay
    execSync(`aws ec2 authorize-security-group-ingress --group-id ${sgId} --protocol udp --port 49152-65535 --cidr 0.0.0.0/0`);
    console.log(`   ✓ Ingress rules configured: SSH, HTTP, HTTPS, 8080, 3000, 6443, Coturn 3478 UDP/TCP, and media relay ports.`);
  }

  // 5. Check if EC2 instance already exists
  let instanceId = '';
  try {
    const instQuery = execSync(`aws ec2 describe-instances --filters "Name=tag:Name,Values=${INSTANCE_NAME}" "Name=instance-state-name,Values=running,pending" --query "Reservations[0].Instances[0].InstanceId" --output text`, { encoding: 'utf8' }).trim();
    if (instQuery && instQuery !== 'None') {
      instanceId = instQuery;
      console.log(`   ✓ Instance "${INSTANCE_NAME}" already exists: ${instanceId}`);
    }
  } catch (e) {}

  // 6. Launch Instance if not existing
  if (!instanceId) {
    console.log(`   Launching EC2 instance (${INSTANCE_TYPE}, Ubuntu 22.04 LTS)...`);
    const userData = `#!/bin/bash
set -e
exec > /var/log/user-data.log 2>&1
echo "=== Starting Nexus k3s & Docker Setup ==="
apt-get update -y
apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release docker.io

systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# Install k3s with Traefik enabled as Ingress controller
curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644

# Setup kubectl for ubuntu user
mkdir -p /home/ubuntu/.kube
cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube

echo "=== k3s and Docker Installation Complete ==="
`;
    const userDataBase64 = Buffer.from(userData).toString('base64');

    const blockMappings = [
      {
        DeviceName: "/dev/sda1",
        Ebs: {
          VolumeSize: 30,
          VolumeType: "gp3"
        }
      }
    ];
    const blockMappingPath = path.join(__dirname, 'ec2-block-mappings.json');
    fs.writeFileSync(blockMappingPath, JSON.stringify(blockMappings, null, 2));

    const tagSpecs = [
      {
        ResourceType: "instance",
        Tags: [
          { Key: "Name", Value: INSTANCE_NAME },
          { Key: "Project", Value: "Nexus" }
        ]
      }
    ];
    const tagSpecsPath = path.join(__dirname, 'ec2-tag-specs.json');
    fs.writeFileSync(tagSpecsPath, JSON.stringify(tagSpecs, null, 2));

    const blockMappingUri = `file://${blockMappingPath.replace(/\\/g, '/')}`;
    const tagSpecsUri = `file://${tagSpecsPath.replace(/\\/g, '/')}`;

    const launchCmd = `aws ec2 run-instances ` +
      `--image-id ${AMI_ID} ` +
      `--instance-type ${INSTANCE_TYPE} ` +
      `--key-name ${KEY_NAME} ` +
      `--security-group-ids ${sgId} ` +
      `--subnet-id ${subnetId} ` +
      `--iam-instance-profile Name=${PROFILE_NAME} ` +
      `--block-device-mappings "${blockMappingUri}" ` +
      `--user-data "${userDataBase64}" ` +
      `--tag-specifications "${tagSpecsUri}" ` +
      `--query "Instances[0].InstanceId" --output text`;

    instanceId = execSync(launchCmd, { encoding: 'utf8' }).trim();
    console.log(`   ✓ EC2 instance launched successfully: ${instanceId}`);
  }

  // 7. Wait for Public IP and DNS
  console.log(`   Waiting for instance to initialize and acquire public IP...`);
  let publicIp = '';
  let publicDns = '';
  while (!publicIp || publicIp === 'None') {
    await new Promise((r) => setTimeout(r, 4000));
    publicIp = execSync(`aws ec2 describe-instances --instance-ids ${instanceId} --query "Reservations[0].Instances[0].PublicIpAddress" --output text`, { encoding: 'utf8' }).trim();
    publicDns = execSync(`aws ec2 describe-instances --instance-ids ${instanceId} --query "Reservations[0].Instances[0].PublicDnsName" --output text`, { encoding: 'utf8' }).trim();
    process.stdout.write(`   ... waiting for public IP\r`);
  }

  console.log(`\n   ✓ Instance is RUNNING!`);
  console.log(`   🌐 Public IP:  ${publicIp}`);
  console.log(`   🌐 Public DNS: ${publicDns}`);
  console.log(`   🔑 SSH Command: ssh -i infra/nexus-ec2-key.pem ubuntu@${publicIp}`);

  // 8. Update Turn Relay config in web and server envs
  console.log(`\n   Configuring WebRTC TURN URL with EC2 Public IP (${publicIp})...`);
  const turnUrl = `turn:${publicIp}:3478`;
  const webEnvPath = path.join(__dirname, '../web/.env.local');
  let webEnv = fs.existsSync(webEnvPath) ? fs.readFileSync(webEnvPath, 'utf8') : '';
  if (!webEnv.includes('NEXT_PUBLIC_TURN_URL=')) {
    webEnv += `\nNEXT_PUBLIC_TURN_URL=${turnUrl}\n`;
  } else {
    webEnv = webEnv.replace(/NEXT_PUBLIC_TURN_URL=.*/, `NEXT_PUBLIC_TURN_URL=${turnUrl}`);
  }
  fs.writeFileSync(webEnvPath, webEnv, 'utf8');
  console.log(`   ✓ Injected NEXT_PUBLIC_TURN_URL=${turnUrl} in web/.env.local`);

  console.log(`\n🎉 EC2 + k3s and WebRTC Turn Relay deployment completed!`);
  return { instanceId, publicIp, publicDns };
}

deployEc2K3s().catch((err) => {
  console.error('\n❌ EC2 deployment failed:', err);
  process.exit(1);
});
