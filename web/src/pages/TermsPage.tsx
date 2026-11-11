// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useState, type ReactNode } from 'react';
import { get } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { useApp } from '../lib/store.ts';
import { COPYRIGHT, TERMS_UPDATED, TERMS_VERSION } from '../lib/brand.ts';
import type { LegalInfo } from '../../../shared/legal.ts';
import { Button } from '../components/ui/button.tsx';

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-labelledby={`terms-${n}`}>
      <h2 id={`terms-${n}`} className="text-lg font-semibold">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

/** The legal details configured on the server (VB_LEGAL_*), readable before signing in. */
export function useLegalInfo(): LegalInfo | null {
  const fromBoot = useApp((s) => s.boot?.legal ?? null);
  const [info, setInfo] = useState<LegalInfo | null>(fromBoot);
  useEffect(() => {
    let live = true;
    get<LegalInfo>('/api/legal')
      .then((r) => live && setInfo(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return info ?? fromBoot;
}

/**
 * Terms of Service, readable before signing in (/terms), from Settings, and inside the acceptance step shown when the
 * terms change (embedded). Change the text here, then TERMS_VERSION in shared/legal.ts so everyone accepts it again.
 */
export function TermsPage({ standalone = false, embedded = false }: { standalone?: boolean; embedded?: boolean }) {
  const legal = useLegalInfo();
  const who = legal?.legalName ? `${legal.legalName} (“Lango”)` : 'Lango';
  const contact = legal?.email ? (
    <>
      {' '}
      at{' '}
      <a className="underline underline-offset-2" href={`mailto:${legal.email}`}>
        {legal.email}
      </a>
    </>
  ) : null;
  return (
    <div className={embedded ? '' : standalone ? 'mx-auto max-w-2xl px-4 py-10' : 'max-w-2xl'}>
      {!embedded && <p className="text-sm font-medium text-muted-foreground">VocabBuilder by Lango</p>}
      <h1 className={embedded ? 'text-xl font-semibold' : 'mt-1 text-[1.9rem] font-semibold leading-tight'}>Terms of Service</h1>
      <p className="hint mt-1">
        Version {TERMS_VERSION}, last updated {TERMS_UPDATED}
      </p>

      <div className="mt-6 space-y-7 leading-relaxed">
        <p>
          These terms are an agreement between you and {who} about VocabBuilder. You accept them by ticking the box when you create your account, by accepting them when VocabBuilder asks after they
          change, or by using VocabBuilder. If you do not agree, do not use it.
        </p>

        <Section n={1} title="Who we are">
          <p>
            VocabBuilder is a product of {legal?.legalName ?? 'Lango'} (“Lango”, “we”, “us”).
            {legal?.address ? ` Address for legal notices: ${legal.address}.` : ''}
            {legal?.email ? ` Email: ${legal.email}.` : ''}
          </p>
        </Section>

        <Section n={2} title="Your licence to use VocabBuilder">
          <p>
            Lango gives you a personal, limited, non-exclusive, non-transferable and revocable licence to install and use VocabBuilder for your own language learning, for as long as you follow these
            terms. You may keep copies of your own data and backups. Lango keeps every right it does not expressly give you.
          </p>
        </Section>

        <Section n={3} title="Ownership, copyright and trade names">
          <p>
            The VocabBuilder software, its design, interface text, graphics and logos, and the content created by or for Lango — including the selection, ranking and arrangement of its words, the
            meanings written or reviewed for it, its explanations and exercises, AI-written sentences and reading passages, and the pictures made for its practices — belong to Lango or its licensors.
            They are protected by copyright, database rights and other laws, where applicable.
          </p>
          <p>“Lango” and “VocabBuilder” and their logos are Lango’s names. Do not use them for your own products or in a way that suggests Lango endorses you.</p>
          <p>{COPYRIGHT}</p>
        </Section>

        <Section n={4} title="What you may not do">
          <p>Unless Lango has given you written permission first, you may not:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>copy, distribute, publish, sell, rent, lend, sublicense or host VocabBuilder or its content for others, or make it available to anyone else, in whole or in part;</li>
            <li>modify, translate or adapt VocabBuilder or its content, or make works based on them;</li>
            <li>decompile, disassemble or reverse engineer VocabBuilder, except where the law allows this regardless of these terms;</li>
            <li>extract or download its content in bulk, or reuse a substantial part of its word lists, meanings, sentences, passages or pictures in another product or database;</li>
            <li>use VocabBuilder or its content to train, test or improve machine-learning or AI systems;</li>
            <li>remove, hide or change copyright notices, labels or these terms;</li>
            <li>get around its security or access controls, or use it in a way that breaks the law.</li>
          </ul>
        </Section>

        <Section n={5} title="Content from others">
          <p>
            Some content comes from other people and projects and stays under its own licence: meanings adapted from English Wiktionary (CC BY-SA 4.0), example sentences from Tatoeba (CC BY 2.0 FR)
            and from Universal Dependencies treebanks (several licences, some for non-commercial use only), word tables built with UniMorph, OpenRussian, verbecc and Morfologik data, frequency lists,
            open-source software and the Lora typeface. Pronunciations from Forvo belong to Forvo and its contributors and are played from Forvo under Forvo’s terms.
          </p>
          <p>
            Those licences govern that content, and nothing in these terms limits the rights they give you. The{' '}
            <Link to="/notices" className="underline underline-offset-2">
              third-party notices
            </Link>{' '}
            list every source, its licence and the credit it asks for, and each sentence’s source is shown on the word’s page.
          </p>
        </Section>

        <Section n={6} title="AI-generated content">
          <p>
            Some sentences, pictures and other content were written or made with AI, and some meanings were reviewed with AI. AI-made content is labelled where it is shown. It is checked, but it
            can contain mistakes, so do not rely on it where accuracy matters.
          </p>
        </Section>

        <Section n={7} title="Your content and your data">
          <p>
            Words, notes, recordings and progress you add stay yours; Lango does not claim ownership of them. VocabBuilder runs on a server that you or your administrator control. Lango does not
            receive your data, and the app contains no advertising trackers or analytics.
          </p>
        </Section>

        <Section n={8} title="No warranty">
          <p>VocabBuilder is provided “as is” and “as available”, without warranties of any kind, to the extent the law allows.</p>
        </Section>

        <Section n={9} title="Limitation of liability">
          <p>
            To the extent the law allows, Lango is not liable for indirect, incidental, special or consequential losses, or for lost data, progress or profits, arising from the use of VocabBuilder.
            Nothing in these terms limits liability that the law does not allow to be limited, or rights you have as a consumer that cannot be waived.
          </p>
        </Section>

        <Section n={10} title="When the licence ends">
          <p>
            Your licence ends automatically if you break these terms. When it ends, stop using VocabBuilder and delete the copies you are not allowed to keep. Sections 3, 4, 8, 9, 12 and 13 continue to
            apply.
          </p>
        </Section>

        <Section n={11} title="Changes to these terms">
          <p>
            Lango may change these terms. The version at the top shows the one in force. When they change, VocabBuilder asks you to read and accept the new version before you continue, and records
            your acceptance with its date.
          </p>
        </Section>

        <Section n={12} title="Governing law">
          {legal?.governingLaw ? (
            <p>
              These terms are governed by the laws of {legal.governingLaw}, and the courts of {legal.governingLaw} decide disputes about them, unless the law where you live gives you the right to go to
              court there.
            </p>
          ) : (
            <p>These terms are governed by the laws of the country where Lango is established, except where the law where you live gives you rights that an agreement cannot change.</p>
          )}
        </Section>

        <Section n={13} title="General">
          <p>
            If a court finds part of these terms unenforceable, the rest still applies. If Lango does not enforce a right straight away, it does not give it up. These terms and the licences named in
            section 5 are the whole agreement about VocabBuilder. You may not transfer your rights under them; Lango may transfer its rights to a successor.
          </p>
        </Section>

        <Section n={14} title="Permission requests and contact">
          <p>
            To ask for permission to copy, distribute or reuse VocabBuilder or its content, or to send a legal notice, contact Lango{contact}
            {legal?.email ? '.' : ' through the person who gave you access to VocabBuilder.'}
          </p>
        </Section>
      </div>

      {!embedded && (
        <p className="mt-10 flex flex-wrap gap-2">
          <Button variant="outline" render={<Link to="/" />}>
            {standalone ? 'Back to sign in' : 'Back to Today'}
          </Button>
          <Button variant="ghost" render={<Link to="/notices" />}>
            Third-party notices
          </Button>
        </p>
      )}
    </div>
  );
}
