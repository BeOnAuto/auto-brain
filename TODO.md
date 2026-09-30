# To Do List

Setup work that couldn't be finished yet, and why.

## Licensing

- [ ] **Build the license-key check into the server before any release with real functionality.**
  - Without a key, the server serves operations up to the free threshold. A signed key, verified offline, carries the limit a customer has paid for (Apollo's router works the same way).
  - Decide what happens at the limit (for example `503`) and when a key expires.
  - The check must ship before auto-brain does anything worth using. Every release is ELv2 forever, so a capable release without the check would stay free at any volume.
- [ ] **Decide the threshold and what counts as an operation.** Publish both in [LICENSING.md](LICENSING.md), which currently says they're coming.
- [ ] **Write the commercial terms.** They grant use above the threshold, keep the ELv2 restrictions, and fall back to ELv2 when a subscription ends. Also give [LICENSING.md](LICENSING.md) a licensing contact address; it currently points at on.auto.
- [ ] **Have a lawyer review:**
  - [LICENSE](LICENSE), [LICENSING.md](LICENSING.md) and [CLA.md](CLA.md)
  - the definitions of "operation" and "managed service"
  - the registered legal name of the licensor (currently "BeOnAuto")
  - whether the ELv2 license-key clause makes the threshold binding

## Community

- [ ] **Create `conduct@on.auto`.** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) sends reports there.
- [ ] **Decide who else is on the CLA allowlist.** Today it's `SamHatoum` and bots. Employees covered by an employment agreement could be added, or sign like everyone else.
- [ ] **Offer a corporate CLA.** [CLA.md](CLA.md) tells employees to ask for one, but none exists yet.

## Hardening

- [ ] **Require signed commits.** Set up SSH or GPG signing for every maintainer and agent that commits, then add `required_signatures` to the `main` ruleset. Turning it on first would block every push.
- [ ] **Add CODEOWNERS and require code-owner review.** Wait until there's more than one maintainer; until then it would only request reviews from the same person who wrote the change.
- [ ] **Make the CLA check required.** It runs on `pull_request_target`, so it never reports on merge-queue commits, and requiring it today would stall the queue. It needs a status that also reports on `merge_group`.
- [ ] **Move harden-runner from audit to block.** Once a few weeks of runs show which endpoints each job calls, switch `egress-policy` to `block` with that allowlist.
- [ ] **Review the first OpenSSF Scorecard report.** It publishes after the Scorecard workflow's first run on `main`. Fix the findings worth fixing.

## First release

- [ ] **Choose the first version.** Merge #49 and then #47 for `0.1.0`, or close #49 and merge #47 for `1.0.0`. `applications/brain` in on.auto pins `0.1.0`.
- [ ] **Make the GHCR package public** after the first release publishes it, so on-prem users can pull without logging in.
- [ ] **Check release-please against immutable releases** on that first release (immutable releases were enabled before any release existed).

## Tests

- [ ] **Run `pnpm exec vitest doctor` again as the suite grows.** On 2026-09-30 it recommended keeping the defaults (forks, isolated), because no alternative was more than 10% faster.
