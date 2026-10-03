import * as vscode from 'vscode';

import type { AutonomyMode, ExplanationDepth, ProviderType } from '../messaging/protocol';

export interface TeachingSettings {
  enabled: boolean;
  knowledgeChecks: boolean;
  followUps: boolean;
}

export interface ProviderSettings {
  type: ProviderType;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface AgentSettings {
  autonomy: AutonomyMode;
  explanationDepth: ExplanationDepth;
  teaching: TeachingSettings;
  experienceLevel: string;
  approvalFileChanges: boolean;
  approvalTerminalCommands: boolean;
  maxToolIterations: number;
  maxOutputChars: number;
  timeoutMs: number;
}

/**
 * Reads VS Code settings + SecretStorage into typed, immutable snapshots.
 * Centralizing this keeps the rest of the code free of raw `workspace.getConfiguration`
 * calls and makes the config surface easy to unit-test with a fake.
 */
export class SettingsService {
  constructor(private readonly _secrets: vscode.SecretStorage) {}

  getProvider(): ProviderSettings {
    const cfg = vscode.workspace.getConfiguration('codementor');
    const type = (cfg.get<ProviderType>('provider.type') ?? 'ollama') as ProviderType;
    if (type === 'openai') {
      return {
        type: 'openai',
        baseUrl: cfg.get<string>('openai.baseUrl', 'https://api.openai.com/v1'),
        model: cfg.get<string>('openai.model', 'gpt-4o-mini'),
        apiKey: undefined, // resolved lazily via getApiKey to avoid exposing in snapshots
      };
    }
    return {
      type: 'ollama',
      baseUrl: cfg.get<string>('ollama.baseUrl', 'http://localhost:11434'),
      model: cfg.get<string>('ollama.model', 'qwen2.5:7b'),
    };
  }

  /** Resolve the API key from SecretStorage. Returns undefined when not set. */
  async getApiKey(provider: ProviderType): Promise<string | undefined> {
    const key = provider === 'openai' ? 'codementor.openai.apiKey' : 'codementor.ollama.apiKey';
    const value = await this._secrets.get(key);
    return value?.length ? value : undefined;
  }

  async setApiKey(provider: ProviderType, value: string | undefined): Promise<void> {
    const key = provider === 'openai' ? 'codementor.openai.apiKey' : 'codementor.ollama.apiKey';
    if (value === undefined || value.length === 0) {
      await this._secrets.delete(key);
    } else {
      await this._secrets.store(key, value);
    }
  }

  getAgent(): AgentSettings {
    const cfg = vscode.workspace.getConfiguration('codementor');
    return {
      autonomy: (cfg.get<AutonomyMode>('autonomy', 'guided') as AutonomyMode) ?? 'guided',
      explanationDepth: (cfg.get<ExplanationDepth>('explanationDepth', 'standard') as ExplanationDepth) ?? 'standard',
      teaching: {
        enabled: cfg.get<boolean>('teaching.enabled', true),
        knowledgeChecks: cfg.get<boolean>('teaching.knowledgeChecks', true),
        followUps: cfg.get<boolean>('teaching.followUps', true),
      },
      experienceLevel: cfg.get<string>('experienceLevel', 'beginner') ?? 'beginner',
      approvalFileChanges: cfg.get<boolean>('approval.fileChanges', true),
      approvalTerminalCommands: cfg.get<boolean>('approval.terminalCommands', true),
      maxToolIterations: Math.max(1, Math.min(200, cfg.get<number>('maxToolIterations', 25))),
      maxOutputChars: Math.max(1000, cfg.get<number>('maxOutputChars', 20000)),
      timeoutMs: Math.max(1000, cfg.get<number>('timeoutMs', 120000)),
    };
  }
}
