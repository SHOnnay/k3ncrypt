# K3NCRYPT product status

Internal product snapshot for the personal-use beta. “Software-tested” records automated or local software validation; it does not imply physical interoperability. “Released” refers to the current capability being distributed as a signed public release.

| Capability | Product status | Implemented | Software-tested | Physically tested | Released |
| --- | --- | --- | --- | --- | --- |
| Web identity and local encrypted vault | BETA LIMITATION | Yes | Yes, prior local build checks | Browser/device coverage remains limited | No current personal-beta release |
| Android identity and local encrypted vault | BETA LIMITATION | Yes | Yes, unit/build validation | Current phone matrix pending | No current personal-beta release |
| One-to-one messaging and explicit contact verification | BETA LIMITATION | Yes | Yes, unit/integration coverage | Web↔Android physical verification flow pending | No current personal-beta release |
| Audio/video calling | BETA LIMITATION | Yes | Yes, signaling/UI/media software tests | Web↔Android physical media pending; no bundled TURN; foreground limits apply | No current personal-beta release |
| Encrypted photo/file/document transfer | BETA LIMITATION | Yes; 8 MiB maximum, 256 KiB chunks, two active transfers, 24-hour expiry; process restart requires a new transfer | Yes, protocol/workflow tests | Physical cross-platform send/save checks pending | No current personal-beta release |
| Local Session | EXPERIMENTAL | Separate experiment | Separately reviewed/tested | Not part of this product path | No |
| Personal beta release packaging | BETA LIMITATION | Build preparation and external signing gate ready | Unsigned preparation validated | Physical product gates pending | No; external signing inputs unavailable |
| Group chat, TURN service, routing nodes, major notifications | NOT STARTED | No | No | No | No |

Release readiness requires signed artifacts, upgrade/signature checks, and physical Web↔Android media and file validation. Do not infer privacy guarantees beyond those demonstrated by the product and its tests.
