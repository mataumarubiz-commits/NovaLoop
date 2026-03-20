# Competitor Project Layer Acceptance

## Preconditions

- Apply `supabase/sql/055_competitor_project_layer.sql`.
- Confirm bucket `project-assets` exists.
- Prepare at least 1 `owner` or `executive_assistant` user and 1 `member` user in the same org.
- Prepare at least 1 client, 1 project, and 2-3 contents under that project.

## Permission Baseline

- `owner` / `executive_assistant`
  - Can view and edit `/projects`, `/projects/[id]`, `/timeline`, `/calendar`, `/materials`, `/changes`, `/exceptions`.
  - Can view and edit `/finance-lite`.
- `member`
  - Can view `/projects`, `/projects/[id]`, `/timeline`, `/calendar`, `/materials`, `/changes`, `/exceptions`.
  - Cannot use edit actions on those screens.
  - Cannot use `/finance-lite`.

## `/projects`

- Project cards render monthly content count, delay count, exception count, and health.
- Search by client, owner, project name, and notes narrows the table.
- Presets `risk`, `margin`, `revision`, `integration`, `delay` change the result set.
- As admin, creating a project inserts one row into `projects`.
- Created project appears immediately after refresh.

## `/projects/[id]`

- Overview tab loads project core fields and saves changes back to `projects`.
- Contents tab shows project-scoped contents only.
- Bulk shift rewrites `due_client_at`, `due_editor_at`, and `delivery_month`.
- Bulk status / assignee / billable update recalculates `health_score`.
- Invalid bulk updates are blocked:
  - `due_editor_at > due_client_at`
  - billable with `unit_price <= 0`
  - workflow progress without required assignee/materials/links
- Tab links open the corresponding dedicated screens with `projectId` query.

## `/contents`

- Contents list loads absorbed fields from `contents`.
- Opening `/contents?projectId=<id>` narrows the list to that project.
- New content form can set `project_id` and `project_name`.
- Detail modal shows and saves:
  - project
  - publish date
  - editor/checker assignee
  - revision count
  - workload points
  - estimated cost
  - next action
  - blocked reason
  - material/draft/final status
  - sequence number
  - links JSON
- Row duplication creates a new content row for similar follow-up work.
- Saved views persist due/client/project filters locally and can be re-applied.
- Saving any content recalculates `health_score`.
- New inserts, template inserts, and bulk inserts all respect absorbed validation rules.

## `/timeline`

- Page filters by `projectId`, assignee, and task status.
- As admin, creating a task inserts one row into `project_tasks`.
- Timeline bar renders when planned dates exist.
- Overdue unfinished tasks are visually identifiable.

## `/calendar`

- Page filters by `projectId` and event type.
- As admin, creating an event inserts one row into `schedule_events`.
- `ICS export` downloads an `.ics` file with current filtered events.

## `/materials`

- Page filters by `projectId`, asset type, and review status.
- File upload stores to `project-assets` and inserts one row into `material_assets`.
- URL-only registration also inserts one row into `material_assets`.
- Opening uploaded asset goes through `/api/project-assets?path=...`.
- Review status update persists to `material_assets.review_status`.
- Re-registering the same title/type/content increments `version_no`.

## `/changes`

- Page filters by `projectId`, status, and impact level.
- As admin, creating a change inserts one row into `change_requests`.
- Status change to `approved` fills `approved_by_user_id` and `approved_at`.
- Extra sales / extra cost / due shift values are visible in the list.

## `/finance-lite`

- `member` cannot access the finance view.
- Admin sees monthly sales, vendor cost, expenses, and gross profit.
- Expense create inserts into `expenses`.
- Rate card create inserts into `rate_cards`.
- Project summary numbers match existing invoice and vendor invoice ledgers when present.
- Billing target month remains `delivery_month`.

## `/exceptions`

- Runtime exceptions appear even before manual persistence.
- `open として登録` turns a runtime exception into one row in `exceptions`.
- Manual exception create inserts one row into `exceptions`.
- Stored exception status can change between `open`, `resolved`, and `ignored`.

## Negative Validation Cases

- Content with `billable_flag = true` and `unit_price = 0` must fail save.
- Content with `due_editor_at > due_client_at` must fail save.
- Content moved to progressed states without editor/checker/material/link requirements must fail save.
- Content with `estimated_cost > unit_price` should save only when business rule allows it.
  - Current implementation blocks it and lowers health.
- Content with many revisions should surface in exceptions / low health.

## Storage and API Checks

- Logged-in same-org user can open `/api/project-assets?path=<org_id>/...`.
- Other-org or malformed path returns `403` or `400`.
- Path traversal such as `..` returns `400`.

## Regression Checks

- Existing `/billing`, `/invoices`, `/vendors`, `/payouts` still build and open.
- Accounting screens remain `owner` / `executive_assistant` only.
- Tax fields were not added.
- Invoice send remains PDF generation only.

## SQL Spot Checks

```sql
select count(*) from public.projects;
select count(*) from public.project_tasks;
select count(*) from public.schedule_events;
select count(*) from public.material_assets;
select count(*) from public.change_requests;
select count(*) from public.expenses;
select count(*) from public.exceptions;

select
  id,
  project_id,
  assignee_editor_user_id,
  assignee_checker_user_id,
  revision_count,
  estimated_cost,
  material_status,
  draft_status,
  final_status,
  health_score
from public.contents
order by updated_at desc
limit 20;
```
