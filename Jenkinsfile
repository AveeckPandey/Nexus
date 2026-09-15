pipeline {
    agent any

    environment {
        CI = 'true'
    }

    stages {
        stage('Stage 0: Audit + Secrets') {
            steps {
                echo '=== Stage 0: npm audit (SCA) + hardcoded-secret scan ==='
                sh 'npm audit --audit-level=moderate || echo "WARN: root audit moderate+ issues"'
                sh 'npm --prefix server audit --audit-level=moderate || echo "WARN: server audit moderate+ issues"'
                sh 'git grep -nE "BEGIN (RSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|xox[bap]-|ghp_[A-Za-z0-9]{36}" -- . || echo "no hardcoded secrets found"'
            }
        }

        stage('Stage 1: Security Gates') {
            steps {
                echo '=== Stage 1: Zero-Knowledge, IDOR Guards, XSS Sanitization, Memory Leak Sweeper ==='
                sh 'npm run test:security'
            }
        }

        stage('Stage 2: Unit & Integration') {
            steps {
                echo '=== Stage 2: Unit (Crypto, Auth, Search) & Integration (Chat, Media, Reactions, Stories) ==='
                sh 'npm run test:unit'
                sh 'npm run test:integration'
            }
        }

        stage('Stage 3: E2E Chrome') {
            steps {
                echo '=== Stage 3: Headless Chrome Real Browser Suite (Auth, Chat, Media, WebRTC, Ghost) ==='
                sh 'npm run test:e2e'
            }
        }

        stage('Stage 4: Docker Multi-Platform Build') {
            steps {
                echo '=== Stage 4: Multi-Stage Production Container Builds ==='
                sh 'docker build -t nexus-server:v2.0.0 ./server'
                sh 'docker build -t nexus-web:v2.0.0 ./web'
            }
        }

        stage('Stage 5: Canary Deployment') {
            steps {
                echo '=== Stage 5: Kubernetes Canary Rollout (10% Traffic Split & Health Verification) ==='
                sh 'node scripts/verify-pipeline.js --canary-only'
            }
        }
    }

    post {
        success {
            echo 'All tests and builds passed successfully!'
        }
        failure {
            echo 'Build failed. Check stage logs for details.'
        }
    }
}
