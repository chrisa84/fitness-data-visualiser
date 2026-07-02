import type { Database } from 'better-sqlite3';
import type { AiSettings, AiSettingsInput } from '@fitness/shared';

interface Row {
  question_model_1: string;
  question_model_2: string;
  question_model_3: string;
  question_selected: string;
  plan_model_1: string;
  plan_model_2: string;
  plan_model_3: string;
  plan_selected: string;
  analysis_model_1: string;
  analysis_model_2: string;
  analysis_model_3: string;
  analysis_selected: string;
}

function mapRow(r: Row): AiSettings {
  return {
    question: {
      models: [r.question_model_1, r.question_model_2, r.question_model_3],
      selected: r.question_selected,
    },
    plan: {
      models: [r.plan_model_1, r.plan_model_2, r.plan_model_3],
      selected: r.plan_selected,
    },
    analysis: {
      models: [r.analysis_model_1, r.analysis_model_2, r.analysis_model_3],
      selected: r.analysis_selected,
    },
  };
}

export function getAiSettings(db: Database): AiSettings {
  const row = db.prepare('SELECT * FROM ai_settings WHERE id = 1').get() as Row;
  return mapRow(row);
}

export function updateAiSettings(db: Database, input: AiSettingsInput): AiSettings {
  db.prepare(
    `UPDATE ai_settings SET
       question_model_1 = @qm1, question_model_2 = @qm2, question_model_3 = @qm3, question_selected = @qs,
       plan_model_1 = @pm1, plan_model_2 = @pm2, plan_model_3 = @pm3, plan_selected = @ps,
       analysis_model_1 = @am1, analysis_model_2 = @am2, analysis_model_3 = @am3, analysis_selected = @asel,
       updated_at = @updatedAt
     WHERE id = 1`,
  ).run({
    qm1: input.question.models[0],
    qm2: input.question.models[1],
    qm3: input.question.models[2],
    qs: input.question.selected,
    pm1: input.plan.models[0],
    pm2: input.plan.models[1],
    pm3: input.plan.models[2],
    ps: input.plan.selected,
    am1: input.analysis.models[0],
    am2: input.analysis.models[1],
    am3: input.analysis.models[2],
    asel: input.analysis.selected,
    updatedAt: new Date().toISOString(),
  });
  return getAiSettings(db);
}
