// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Legal notices: every source file of Lango's carries the copyright header, and the third-party notices shipped with
// the app include the licence texts and credits they must.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JavaScript build script
import { missingNotices, withNotice, hasNotice } from '../../scripts/legal/headers.mjs';
// @ts-expect-error plain JavaScript build script
import { thirdPartyNotices } from '../../scripts/legal/notices.mjs';
import { COPYRIGHT, TERMS_VERSION } from '../../shared/legal.ts';

test('every Lango source file starts with the copyright header', () => {
  assert.deepEqual(missingNotices(), [], 'run: node scripts/legal/headers.mjs --write');
});

test('the header goes after a shebang or encoding line and is recognised', () => {
  assert.equal(withNotice('a.sh', '#!/bin/sh\necho hi\n'), '#!/bin/sh\n# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.\necho hi\n');
  assert.equal(withNotice('a.css', 'body{}'), '/* © 2026 Lango. All rights reserved. Proprietary — see LICENSE. */\nbody{}');
  assert.match(withNotice('a.py', '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nx = 1\n').split('\n')[2], /^# © 2026 Lango/);
  assert.equal(hasNotice('// © 2026 Lango. All rights reserved.\nconst a = 1;'), true);
  assert.equal(hasNotice('const a = 1;\n'), false);
});

test('the third-party notices carry the licence texts and credits the app needs', () => {
  const text: string = thirdPartyNotices();
  for (const pkg of ['react ', 'react-dom ', 'scheduler ', '@tanstack/react-virtual ', 'react-icons ', 'tailwindcss ', 'clsx ', 'tailwind-merge ', 'class-variance-authority ', 'zod ']) assert.ok(text.includes(`\n${pkg}`), pkg);
  assert.ok(text.includes('Copyright (c) 2023 shadcn'), 'the interface components credit shadcn/ui (MIT)');
  assert.ok(text.includes('Apache License'), 'class-variance-authority comes with the Apache licence text');
  assert.ok(text.includes('Copyright (c) 2022 Open Spaced Repetition'), 'the scheduler port credits py-fsrs (MIT)');
  assert.ok(text.includes('Permission is hereby granted'), 'with the MIT permission notice');
  assert.ok(text.includes('Copyright 2011 The Lora Project Authors'), 'the typeface licence');
  assert.ok(text.includes('CC BY-NC-SA 4.0'), 'non-commercial sources are named');
  assert.ok(text.includes('Lucide'), 'icon set licence');
});

test('the copyright line and terms version are well formed', () => {
  assert.equal(COPYRIGHT, '© 2026 Lango. All rights reserved.');
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}[a-z]?$/);
});
