# Test images

| File              | What                                                                                                                              | Source                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `C.jpg`           | Valid manifest, test signer, created algorithmically (not AI)                                                                     | contentauth/c2pa-rs `sdk/tests/fixtures` at `4973da7` (MIT / Apache-2.0) |
| `XCA.jpg`         | Manifest whose image data was changed after signing (hash mismatch)                                                               | same                                                                     |
| `plain.jpg`       | A generated gradient with no manifest and no metadata                                                                             | made for this repo                                                       |
| `ai-declared.jpg` | `plain.jpg` signed with the public C2PA **test** certificate (`es256` from c2pa-rs fixtures), declaring `trainedAlgorithmicMedia` | made for this repo with `@contentauth/c2pa-node`                         |

The test certificate is public and not on any trust list, so these manifests validate as intact but from an unrecognised signer.

`test-anchors.pem` is the root certificate bundle for those test certificates (c2pa-rs `sdk/tests/fixtures/certs/trust/test_cert_root_bundle.pem`). Tests use it to exercise the "trusted signer" path; it is never used outside tests.
