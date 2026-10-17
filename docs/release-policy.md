# Release / deployment policy

## Branch roles

- `feature/*`, `fix/*`, `api/*` (and other work branches): development and testing only. Submit implementation pull requests into **`develop`**, not `main`.
- **`develop`**: integrated development state; Frontend and Backend changes may merge here after CI, code review, and integration checks. **Does not trigger Vercel Git automatic deployment.**
- **`main`**: release and production branch. Only an approved, **batched release** from `develop` is merged into `main`. **Only `main` triggers Vercel Git automatic deployment.**

## What counts as a release

Group related, completed functionality into a cohesive release rather than publishing every small development PR. Ideally the unit contains the matching frontend, backend, migrations/configuration (where applicable), regression tests and validated user flows. There is no fixed release cadence or minimum count of commits. The release unit is based on **end-to-end readiness** rather than the size of a diff.

The project manager reviews and explicitly approves a **`develop` → `main` PR**. No developer Work agent should merge it autonomously. Smaller implementation PRs into `develop` continue as usual.

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
