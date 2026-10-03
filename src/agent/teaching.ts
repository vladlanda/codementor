import type {
  FollowUpSuggestion,
  KnowledgeCheck,
  LearningCheckpoint,
  LearningProfileData,
} from '../messaging/protocol';

/**
 * The teaching engine, kept free of the `vscode` module so it can be unit-tested
 * in plain Node. The model is asked to append a small, machine-readable block of
 * "teaching artifacts" to the end of its final answer. We parse that block here,
 * strip it from the visible text, and hand structured records to the host so it can
 * render checkpoint cards, knowledge checks, and follow-up prompts, and update the
 * learning profile conservatively.
 *
 * Artifact block format (emitted by the model, parsed here):
 *
 *   [[CODEMENTOR_TEACHING
 *   checkpoint: <concept> | <optional true|false> | <explanation>
 *   check: <concept> | <question> | <hint (optional)>
 *   followup: <label> | <prompt>
 *   ]]
 */

const BLOCK_OPEN = '[[CODEMENTOR_TEACHING';
const BLOCK_CLOSE = ']]';

export interface TeachingArtifact {
  /** Text with the artifact block removed, trimmed. */
  visibleText: string;
  checkpoints: LearningCheckpoint[];
  checks: Array<{ concept?: string; check: KnowledgeCheck }>;
  followUps: FollowUpSuggestion[];
}

/** Split a line on the first two `|` separators, trimming each field. */
function splitFields(line: string): string[] {
  const parts = line.split('|');
  if (parts.length >= 3) {
    // Rejoin any overflow into the last field so a stray `|` in text doesn't drop it.
    return [parts[0].trim(), parts[1].trim(), parts.slice(2).join('|').trim()];
  }
  return parts.map((p) => p.trim());
}

/**
 * Parse a model answer for teaching artifacts. If no well-formed block is present
 * (e.g. provider disabled teaching, or the model skipped it), the text is returned
 * unchanged and the artifact arrays are empty.
 */
export function parseTeachingArtifacts(text: string): TeachingArtifact {
  const empty: TeachingArtifact = {
    visibleText: text.trim(),
    checkpoints: [],
    checks: [],
    followUps: [],
  };
  if (!text) {
    return empty;
  }

  const startIdx = text.indexOf(BLOCK_OPEN);
  if (startIdx === -1) {
    return empty;
  }
  const endIdx = text.indexOf(BLOCK_CLOSE, startIdx);
  if (endIdx === -1) {
    // Unterminated block: treat the whole thing as a model slip and surface nothing.
    return empty;
  }

  const visibleText = (text.slice(0, startIdx) + text.slice(endIdx + BLOCK_CLOSE.length)).trim();
  const block = text.slice(startIdx + BLOCK_OPEN.length, endIdx);

  const checkpoints: LearningCheckpoint[] = [];
  const checks: Array<{ concept?: string; check: KnowledgeCheck }> = [];
  const followUps: FollowUpSuggestion[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const checkpointMatch = /^checkpoint\s*[:：]\s*(.*)$/i.exec(line);
    if (checkpointMatch) {
      const [concept, optional, explanation] = splitFields(checkpointMatch[1]);
      if (concept) {
        checkpoints.push({
          concept,
          optional: optional.toLowerCase() === 'true' || optional.toLowerCase() === 'yes',
          explanation: explanation || concept,
        });
      }
      continue;
    }

    const checkMatch = /^check\s*[:：]\s*(.*)$/i.exec(line);
    if (checkMatch) {
      const [concept, question, hint] = splitFields(checkMatch[1]);
      if (question) {
        checks.push({
          concept: concept || undefined,
          check: { question, hint: hint || undefined },
        });
      }
      continue;
    }

    const followMatch = /^followup\s*[:：]\s*(.*)$/i.exec(line);
    if (followMatch) {
      const parts = followMatch[1].split('|').map((p) => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        followUps.push({ label: parts[0], prompt: parts.slice(1).join(' | ').trim() });
      }
      continue;
    }
  }

  return { visibleText, checkpoints, checks, followUps };
}

/**
 * Prompt fragment instructing the model to emit the artifact block. Only included
 * when teaching is enabled. The format is kept simple and line-oriented so a small
 * model can reliably follow it.
 */
export function buildTeachingInstructions(enabled: boolean): string {
  if (!enabled) {
    return '';
  }
  return [
    '## Teaching artifacts (structured output)',
    'When teaching is enabled, at the very end of your final answer — AFTER any prose explanation —',
    'append exactly one block in this precise format so the user can see checkpoint cards,',
    'optional knowledge checks, and suggested follow-ups. Use the separator " | " between fields.',
    'Omit a line if you have nothing to report for it. Keep explanations to one or two sentences.',
    '',
    '[[CODEMENTOR_TEACHING',
    'checkpoint: <concept name> | <true|false> | <one-sentence explanation of the concept>',
    'check: <concept name> | <one question to test understanding> | <optional hint>',
    'followup: <short label> | <prompt text the user would send>',
    'followup: <short label> | <prompt text the user would send>',
    ']]',
    '',
    'Rules:',
    '- Only include a `checkpoint` for a concept genuinely introduced or demonstrated in this answer.',
    '- Mark a checkpoint `optional` as `false` when it is a core concept worth checking, `true` for a lighter one.',
    '- Include at most one `check` and at most four `followup` lines.',
    '- Do not invent concepts that were not part of your answer.',
    '- If there is nothing to report, omit the block entirely.',
  ].join('\n');
}

/**
 * Render a compact, prompt-friendly snapshot of the learning profile so the model
 * can tailor explanation depth and avoid re-teaching what the user already
 * demonstrated. Capped to keep prompt size bounded.
 */
export function buildProfileSnapshot(profile: LearningProfileData | undefined, maxConcepts = 20): string {
  if (!profile || (!profile.concepts.length && !profile.notes && !profile.experienceLevel)) {
    return '';
  }
  const lines: string[] = [];
  if (profile.experienceLevel) {
    lines.push(`Experience level: ${profile.experienceLevel}`);
  }
  if (profile.concepts.length) {
    const shown = profile.concepts.slice(0, maxConcepts);
    lines.push('Concepts on record:');
    for (const c of shown) {
      lines.push(`- ${c.concept} (${c.status}${c.evidence ? `: ${c.evidence}` : ''})`);
    }
    if (profile.concepts.length > maxConcepts) {
      lines.push(`- …and ${profile.concepts.length - maxConcepts} more`);
    }
  }
  if (profile.notes) {
    lines.push(`Notes: ${profile.notes}`);
  }
  return lines.join('\n');
}
