import Link from 'next/link';
import { setPlanStepDone } from '../actions';
import { CheckItem } from '@/components/CheckItem';
import { Tag } from '@/components/Tag';
import type { PlanStep } from '@/generated/prisma/client';
import type { TagColor } from '@/lib/labels';
import { getStudyPlans, planProgress, stepHref, type StudyPlan } from '@/lib/study-plan';
import { repoUrl } from '@/lib/sync';
import { buildCampaign } from '@/lib/campaign';
import { CampaignMap } from '@/components/CampaignMap';

const KIND_LABEL: Record<PlanStep['kind'], { label: string; color: TagColor }> = {
  READ: { label: 'Read', color: 'gray' },
  ATTEMPT: { label: 'Attempt', color: 'orange' },
  REFERENCE: { label: 'Reference', color: 'blue' },
  SUMMARY: { label: 'Summary', color: 'purple' },
  DEPTH: { label: 'Depth', color: 'green' },
  EXAM: { label: 'Exam', color: 'red' },
};

interface StepGroup {
  name: string;
  steps: PlanStep[];
}

function groupSteps(steps: PlanStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.name === step.group) last.steps.push(step);
    else groups.push({ name: step.group, steps: [step] });
  }
  return groups;
}

function hours(minutes: number): string {
  return minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`;
}

export default async function PlanPage() {
  const plans = await getStudyPlans();
  const now = new Date();

  return (
    <div className="page">
      <h1 className="page-title">Study plan</h1>
      <p className="page-sub">
        Steps come from <code>learn/plan.md</code> in the repo and go strictly in order. Each day the plan on Today takes the next
        steps up to the plan&apos;s daily limit, with at most one new problem. A problem&apos;s attempt counts by itself after its recall;
        redos come back on their own schedule. On the map a week is a region, a problem is a fortress (attempt, reference, summary),
        and a fortress cracks when its redo is due.
      </p>

      {plans.length === 0 && (
        <p className="faint">No plan yet. Add a repo with <code>learn/plan.md</code> on <Link href="/sources" style={{ textDecoration: 'underline' }}>Sources</Link>.</p>
      )}

      {plans.map((plan: StudyPlan) => {
        const progress = planProgress(plan);
        const totalMinutes = plan.steps.reduce((sum, step) => sum + step.minutes, 0);
        const leftMinutes = plan.steps.filter((step) => step.doneAt === null).reduce((sum, step) => sum + step.minutes, 0);
        return (
          <div key={plan.source.id} style={{ marginBottom: 28 }}>
            <div className="callout">
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <b>{plan.source.planName}</b>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {progress.done}/{progress.total} steps · {hours(leftMinutes)} left of {hours(totalMinutes)} · {plan.source.planDailyMinutes} min/day
                  </span>
                </div>
                <div className="progress" style={{ marginTop: 8 }}>
                  <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
                <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                  from <a href={repoUrl(plan.source)} target="_blank" rel="noreferrer">{plan.source.repo}</a>/learn/plan.md
                </div>
              </div>
            </div>

            <CampaignMap campaign={buildCampaign(plan, now)} />

            <details className="plan-list">
              <summary>📋 All steps as a list</summary>
              {groupSteps(plan.steps).map((group) => {
                const doneInGroup = group.steps.filter((step) => step.doneAt !== null).length;
                return (
                  <div key={group.name || 'steps'}>
                    <h2 className="block-title">
                      {group.name || 'Steps'}{' '}
                      <span className="faint" style={{ fontWeight: 400, fontSize: 15 }}>{doneInGroup}/{group.steps.length}</span>
                    </h2>
                    {group.steps.map((step) => {
                      const kind = KIND_LABEL[step.kind];
                      const href = stepHref(plan, step);
                      const external = href.startsWith('http');
                      const isNext = progress.next?.id === step.id;
                      return (
                        <div
                          key={step.id}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 4px', borderBottom: '1px solid var(--border)', background: isNext ? 'var(--hover)' : undefined, borderRadius: 4 }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <CheckItem
                              checked={step.doneAt !== null}
                              label={<span>{step.title}{isNext && <span className="faint" style={{ fontSize: 12 }}>  ← next</span>}</span>}
                              action={setPlanStepDone.bind(null, step.id)}
                            />
                          </div>
                          <Tag color={kind.color}>{kind.label}</Tag>
                          <span className="faint mono" style={{ width: 44, textAlign: 'right' }}>{step.minutes}m</span>
                          {external ? (
                            <a href={href} target="_blank" rel="noreferrer" className="btn sm ghost" title="Open">↗</a>
                          ) : (
                            <Link href={href} className="btn sm ghost" title="Open">→</Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </details>
          </div>
        );
      })}
    </div>
  );
}
