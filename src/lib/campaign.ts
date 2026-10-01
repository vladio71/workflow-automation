import type { PlanStepKind } from '@/generated/prisma/enums';
import { endOfDay } from './schedule';
import { stepHref, type StudyPlan } from './study-plan';

/**
 * Навчальний план як карта кампанії (постійна, не скидається).
 * Регіон = група з plan.md ("Тиждень 1 · ..."). Задача (спроба → еталон → саммарі) = фортеця з трьох частин,
 * читання й поглиблення = менші вузли, екзамен = бос. Пройдене горить, поточне пульсує, решта закрита.
 * Задача, в якої настав термін переробки, "тріскається"; переробка (recall) її лагодить.
 */

export type SiteKind = 'fortress' | 'read' | 'depth' | 'boss';
export type SiteState = 'done' | 'current' | 'locked';
export type RegionState = 'conquered' | 'current' | 'locked';

export interface CampaignStep {
  id: number;
  title: string;
  kind: PlanStepKind;
  minutes: number;
  done: boolean;
  href: string;
}

export interface CampaignSite {
  id: string;
  kind: SiteKind;
  /** коротка назва: текст до першої двокрапки ("URL shortener", "Модуль 02 кешування") */
  name: string;
  state: SiteState;
  /** задача пройдена, але настав термін переробки */
  cracked: boolean;
  steps: CampaignStep[];
}

export interface CampaignRegion {
  name: string;
  state: RegionState;
  done: number;
  total: number;
  sites: CampaignSite[];
}

export interface Campaign {
  sourceId: number;
  planName: string;
  regions: CampaignRegion[];
  done: number;
  total: number;
  /** індекс регіону з поточним кроком; -1 = усе пройдено */
  currentRegion: number;
}

const SHORT_NAME_LENGTH = 34;

export function siteName(title: string): string {
  const head = title.split(':')[0]?.trim() || title;
  return head.length > SHORT_NAME_LENGTH ? `${head.slice(0, SHORT_NAME_LENGTH - 1)}…` : head;
}

function siteKind(kind: PlanStepKind): SiteKind {
  if (kind === 'ATTEMPT') return 'fortress';
  if (kind === 'EXAM') return 'boss';
  if (kind === 'READ') return 'read';
  return 'depth';
}

export function buildCampaign(plan: StudyPlan, now: Date = new Date()): Campaign {
  const dueBy = endOfDay(now);
  const nextStep = plan.steps.find((step) => step.doneAt === null) ?? null;
  const regions: CampaignRegion[] = [];
  let currentSiteSeen = false;

  for (const step of plan.steps) {
    const campaignStep: CampaignStep = {
      id: step.id,
      title: step.title,
      kind: step.kind,
      minutes: step.minutes,
      done: step.doneAt !== null,
      href: stepHref(plan, step),
    };
    let region = regions[regions.length - 1];
    if (!region || region.name !== step.group) {
      region = { name: step.group, state: 'locked', done: 0, total: 0, sites: [] };
      regions.push(region);
    }
    region.total += 1;
    if (campaignStep.done) region.done += 1;

    // еталон і саммарі належать фортеці задачі, перед якою стоять
    const last = region.sites[region.sites.length - 1];
    const joinsFortress = (step.kind === 'REFERENCE' || step.kind === 'SUMMARY') && last?.kind === 'fortress';
    if (joinsFortress && last) {
      last.steps.push(campaignStep);
    } else {
      region.sites.push({ id: `step-${step.id}`, kind: siteKind(step.kind), name: siteName(step.title), state: 'locked', cracked: false, steps: [campaignStep] });
    }

    if (step.kind === 'ATTEMPT') {
      const topic = plan.topicByPath.get(step.topicPath);
      const site = region.sites[region.sites.length - 1];
      if (site && topic?.nextReviewAt && topic.nextReviewAt <= dueBy) site.cracked = true;
    }
  }

  let currentRegion = -1;
  regions.forEach((region, regionIndex) => {
    for (const site of region.sites) {
      const allDone = site.steps.every((step) => step.done);
      if (allDone) site.state = 'done';
      else if (!currentSiteSeen && nextStep && site.steps.some((step) => step.id === nextStep.id)) {
        site.state = 'current';
        currentSiteSeen = true;
        currentRegion = regionIndex;
      }
      // тріщина тільки на пройденій задачі: непройдену ще нема що лагодити
      if (site.state !== 'done') site.cracked = false;
    }
    if (region.done === region.total) region.state = 'conquered';
    else if (regionIndex === currentRegion) region.state = 'current';
  });

  const done = plan.steps.filter((step) => step.doneAt !== null).length;
  return {
    sourceId: plan.source.id,
    planName: plan.source.planName || plan.source.repo,
    regions,
    done,
    total: plan.steps.length,
    currentRegion,
  };
}
