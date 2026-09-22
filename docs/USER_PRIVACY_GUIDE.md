# K3NCRYPT User Privacy Guide

K3NCRYPT is designed so the service relays encrypted data and controls availability, while message content, attachment plaintext, and local identity keys remain outside normal server access.

## What the server can see

The server can process the minimum operational information needed to relay traffic: encrypted envelopes, routing/service timing, account-control requests, and encrypted attachment objects. Relays can observe connection metadata needed to deliver traffic. A site bridge can observe encrypted packets and routing metadata required to forward an explicitly approved route.

## What the server cannot read through the intended design

The server does not receive message plaintext, attachment plaintext, message encryption keys, local vault passphrases, or decrypted call audio/video. System notifications use generic text by default: **K3NCRYPT — New message**. Sender and message content appear only if you explicitly enable previews.

## Your responsibilities

Protect your device, local passphrase, recovery material, and invitations. Verify important contact fingerprints through another channel. Review trusted devices regularly and revoke lost devices. Use mute, preview, screen-privacy, and background-blur controls where appropriate. Platform screenshot prevention varies: Android can use a secure-window integration, iOS can detect capture, and desktop protection depends on the operating system. These controls reduce exposure where supported; they cannot prevent a person from photographing a screen.
