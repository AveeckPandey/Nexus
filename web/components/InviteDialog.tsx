'use client';

import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Input,
  Button,
} from '@heroui/react';
import { authApi } from '@/lib/api';
import {
  buildPersonalInviteLink,
  copyText,
  sharePersonalInvite,
} from '@/lib/invite';

/**
 * One-click share link: nexus.app/invite?u=<username>.
 * Native OS share sheet on mobile/desktop, clipboard fallback elsewhere.
 */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [link, setLink] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setError(null);
    if (link) return;
    setLoading(true);
    authApi
      .inviteMe()
      .then((inv) => {
        setUsername(inv.username);
        setName(inv.name || '');
        setLink(buildPersonalInviteLink(inv.username || inv.userId));
      })
      .catch(() => setError('Could not load your invite link. Retry in a moment.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const share = async () => {
    if (!link) return;
    const outcome = await sharePersonalInvite({ url: link, username, name });
    setNotice(
      outcome === 'shared'
        ? 'Share sheet opened — pick WhatsApp, SMS, email…'
        : outcome === 'copied'
          ? 'Invite link copied — paste it anywhere.'
          : 'Sharing failed — long-press the link to copy it manually.',
    );
  };

  const copy = async () => {
    if (!link) return;
    setNotice((await copyText(link)) ? 'Invite link copied.' : 'Copy failed — select the link manually.');
  };

  return (
    <Modal isOpen={open} onClose={onClose} placement="top-center">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span>Invite a friend</span>
          <span className="text-xs font-normal text-default-500">
            One tap → they open an encrypted chat with you. No app download.
          </span>
        </ModalHeader>
        <ModalBody className="pb-6 space-y-3">
          {loading && <p className="text-xs text-default-500">Preparing your link…</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
          {link && (
            <>
              <Input label="Your personal invite link" value={link} readOnly onFocus={(e) => e.target.select()} />
              <div className="flex gap-2">
                <Button color="secondary" className="flex-1" onPress={share} isDisabled={!link}>
                  Share…
                </Button>
                <Button variant="flat" className="flex-1" onPress={copy} isDisabled={!link}>
                  Copy link
                </Button>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <span className="bg-white p-2 rounded-xl shrink-0">
                  <QRCode value={link} size={88} />
                </span>
                <p className="text-[11px] leading-5 text-default-500">
                  In person? They scan this QR and land straight in a chat with{' '}
                  <b>@{username}</b>. New friends sign up in ~10 seconds and the
                  conversation is created automatically.
                </p>
              </div>
            </>
          )}
          {notice && <p className="text-xs text-secondary">{notice}</p>}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

