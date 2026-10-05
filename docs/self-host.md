# Self-hosting

Auto Cloud hosts the runtime for you. Follow [Connect your agent](https://on.auto/docs/get-started/cloud) to use that service without operating a deployment.

Self-hosting gives your team control over where the runtime and its recorded data run. Auto's runtime is source-available; review the repository's [licensing terms](https://github.com/BeOnAuto/auto-brain/blob/main/LICENSING.md) when planning a deployment.

## Plan your deployment with Xolvio

[Xolvio Professional Services](https://www.xolv.io/contact-us) can help you assess the deployment, connect your systems and establish an operating plan. Bring your requirements for data location, access, model providers and availability.

Your team will need to own infrastructure and updates, credentials and access controls, persistent storage and tested backups, monitoring, and recovery. Workflows run inside the runtime and keep their state in its database, so the database's backups cover them; run one runtime for a database. Decide who can read recorded inputs and results, and which information can be sent to model providers.

Review [Function availability](concepts/functions.md#availability) and agree the support requirements of the version you plan to deploy before committing to a production workload.

For contributor setup and implementation details, see the repository's [engineering guides](https://github.com/BeOnAuto/auto-brain/tree/main/docs/engineering). Those notes follow the development checkout and are maintained with the code.
