#!/usr/bin/env python3
"""Copiază fișierele PWA în www/ pentru Capacitor (fără teste, capturi, android)."""
import os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW = os.path.join(ROOT, 'www')
if os.path.isdir(WWW):
    shutil.rmtree(WWW)
os.makedirs(WWW)
for name in ('index.html', 'manifest.webmanifest', 'sw.js'):
    shutil.copy2(os.path.join(ROOT, name), os.path.join(WWW, name))
for d in ('css', 'js', 'i18n', 'icons', 'fonts'):
    shutil.copytree(os.path.join(ROOT, d), os.path.join(WWW, d))
print('www', sum(len(fs) for _, _, fs in os.walk(WWW)), 'fișiere')
