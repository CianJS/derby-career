# Release / deployment policy

## Branch roles

- `feature/*`, `fix/*`, `api/*` (and other work branches): development and testing only. Submit implementation pull requests into **`develop`**, not `main`.
- **`develop`**: integrated development state; Frontend and Backend changes may merge here after relevant existing CI, code review, and explicit user approval. **Does not trigger Vercel Git automatic deployment.**
- **`main`**: release and production branch. Only an approved, **batched release** from `develop` is merged into `main`. **Only `main` triggers Vercel Git automatic deployment.**

## What counts as a release

Group related, completed functionality into a cohesive release rather than publishing every small development PR. Ideally the unit contains the matching frontend, backend, migrations/configuration (where applicable), regression tests and validated user flows. There is no fixed release cadence or minimum count of commits. The release unit is based on **end-to-end readiness** rather than the size of a diff.

The project manager (user) explicitly approves every merge, including implementation PRs into `develop` and release PRs from **`develop` → `main`**. Work agents create PRs and leave them unmerged unless the user explicitly authorizes that merge. AI review or green CI alone is not merge approval. Do not enable auto-merge.

Work branches and ownership are defined in [CONTRIBUTING.md](../CONTRIBUTING.md); risk, independent review and evidence requirements are defined in [pr-review-policy.md](pr-review-policy.md). Work agents must not directly push to `develop` or `main`, or push to another Work's development branch.

Preview deployment of `develop` is manual and user-controlled. Neither Production nor Preview deployment, repository settings, branch protection, Secrets, nor Vercel settings may be changed or executed without explicit user authorization. A request to implement code and create a PR does not authorize those actions.

## Release checklist

1. Select the completed feature set and document the scope / excluded unfinished items.
2. Confirm frontend/backend compatibility, API contracts, database migrations, authentication, and game save modes.
3. Verify `develop` CI (backend, frontend, Vercel build and Chromium regression), and investigate outstanding checks.
4. Confirm Vercel **Production** environment variables, backend access protection, database connection and production branch tracking before first release. Preview-only secrets and URLs must not be assumed available in Production.
5. Open one `develop` → `main` release PR, review its **full cumulative diff** against the currently older `main`, and require project-manager approval for merge.
6. After merge, verify the frontend/API Production deployments, real HTTP catalog and core gameplay/save flows; document rollback if verification fails.

## Vercel configuration

Both the repository root `vercel.json` (frontend and any project using the root configuration) and `services/api/vercel.json` (backend) restrict automatic Git deployment with:

```json
{
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true
    }
  }
}
```

This rule affects branches containing these configuration files. Existing old branches with outdated files can still auto-deploy before they take the latest `develop`. Project-level disabling of Preview deployments provides a stronger restriction where available. An explicit Vercel API/CLI manual deployment is outside this Git-only rule.

**Important:** GitHub branch protection, when available, should require PR review before direct commits reach `main`. The Vercel configuration alone does not prevent a direct push to `main`.

Vercel documentation: https://vercel.com/docs/project-configuration/git-configuration
