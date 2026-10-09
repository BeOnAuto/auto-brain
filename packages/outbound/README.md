# @beonauto/outbound

How the server tells a certificate it does not trust from any other failure of a call to a system on the internet. The reasoning function adapter and the MCP package take the classification from here, so a model provider and a tool server whose certificate the server does not trust are named alike, as [decision 0010](../../docs/decisions/0010-interaction-functions.md) set out; every caller keeps its own client and bounds.

## Certificates

`isUntrustedCertificate(error)` says whether any of the causes of a failed call, eight deep at most, carries the code of a certificate the server does not trust, and `codesOf(error)` names those codes.

## Source

`src/certificates` holds the classification.
