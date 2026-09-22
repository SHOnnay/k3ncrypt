# K3NCRYPT Beta Release Guide

## Install and first setup

Use the hosted web application for the current beta, or build the client with `npm run client:build` and deploy the generated `client/dist` files behind HTTPS. Open K3NCRYPT, choose **Create a private contact**, and choose a local passphrase of at least 12 characters. The passphrase unlocks encrypted local account data on that device; it is not an account password sent to the server.

Share the generated invitation only with the intended contact. They open it in K3NCRYPT and choose a local passphrase for their device. Compare identity fingerprints in Settings → Identity through a separate trusted channel before marking a contact verified.

## Devices and recovery

Use Settings → Identity to review trusted devices and request an enrollment. Enrollment requires approval through the authenticated device-control path and the new device confirms independently. Revoke a lost or retired device immediately. Keep recovery material offline and private; recovery replaces local identity state and invalidates previous device trust according to the Phase 6 recovery ceremony.

## Messages, media, and calls

Messages and protected media are encrypted before delivery. A failed send can be retried from the conversation. Use the call button to begin a call, and accept an incoming call before any microphone or camera request. Declining, ending, timeout, and transport failure all stop the call ringtone and release call resources.

## Private networks

Private-network nodes and site bridges are optional advanced features. Add only devices you control and trust. Site bridges authorize exact host and service routes; they do not automatically expose a LAN. See the Phase 8D reports for self-hosting and routing requirements.

## Troubleshooting

If a vault will not unlock, verify the local passphrase and do not delete browser data before using your recovery process. If a device reports blocked trust, reconnect and wait for a verified trust refresh. If calls cannot connect, check microphone permission, network/firewall restrictions, and configured TURN services. Never send a local passphrase, recovery material, or invitation URL to support staff.
