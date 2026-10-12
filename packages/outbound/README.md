# @beonauto/outbound

How the server calls systems on the internet. It tells a certificate the server does not trust from any other failure of a call: the reasoning function adapter and the MCP package take the classification from here, so a model provider and a tool server whose certificate the server does not trust are named alike, as [decision 0010](../../docs/decisions/0010-interaction-functions.md) set out; every caller keeps its own client and bounds. And it makes the settings of a client of the AWS SDK, which the Bedrock provider of the reasoning capability and the object store of [`@beonauto/object-storage`](../object-storage/README.md) share.

## Certificates

`isUntrustedCertificate(error)` says whether any of the causes of a failed call, eight deep at most, carries the code of a certificate the server does not trust, and `codesOf(error)` names those codes.

## AWS clients

`proxySettingsOf(environment)`, in the main entry, reads `ProxySettings`, `{ enabled, environment }`: the switch, `NODE_USE_ENV_PROXY=1`, and the proxy's variables that are set, `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` in either case. The server reads them once and hands them to every client it makes, the model providers' and the object store's.

`@beonauto/outbound/aws` (`src/aws/aws-clients.ts`) is a subpath of its own, so that the packages that take the classification of certificates alone, the MCP package among them, load no part of the AWS SDK. `awsCredentialChain(proxy)` is the default credential chain of the AWS SDK, `fromNodeProviderChain` of `@aws-sdk/credential-providers`, which resolves credentials from the environment, the shared files, single sign-on, a process, a web identity, the container or the instance, looking nothing up until a call needs them. `awsClientSettingsOf(proxy)` is the part of a client's settings that sends its requests through the environment proxy, `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, when Node is told to with `NODE_USE_ENV_PROXY=1`, by the `proxyEnv` of the agents of its request handler, since a client of the AWS SDK makes agents of its own that the switch alone does not reach; without the switch it is empty. The chain's own clients take the same settings, by HTTP as well as by HTTPS: the agent of each carries the proxy's variables, so a credential endpoint reached by HTTP, such as a container's, goes through the proxy too unless `NO_PROXY` names it, where the reasoning capability's chain once set the HTTPS agent alone.

## Source

`src/certificates` holds the classification, `src/proxy` the settings of the environment proxy, and `src/aws` the settings of AWS clients.
