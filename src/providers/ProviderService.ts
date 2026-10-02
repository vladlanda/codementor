import type { ProviderSettings, SettingsService } from '../services/SettingsService';
import type { LLMProvider } from './provider';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import type * as vscode from 'vscode';

/**
 * Builds the active {@link LLMProvider} from current settings + secrets.
 * Resolving the API key lazily here keeps secrets out of typed snapshots and logs.
 */
export class ProviderService {
  constructor(
    private readonly _settings: SettingsService,
    private readonly _secrets: vscode.SecretStorage
  ) {}

  public async create(): Promise<LLMProvider> {
    const cfg = this._settings.getProvider();
    const timeoutMs = this._settings.getAgent().timeoutMs;

    if (cfg.type === 'openai') {
      const apiKey = await this._settings.getApiKey('openai');
      if (!apiKey) {
        throw new Error('No API key configured for the OpenAI-compatible provider. Run "CodeMentor: Connect Provider" and add a key, or set codementor.openai.apiKey.');
      }
      return new OpenAICompatibleProvider(cfg.baseUrl, cfg.model, apiKey, timeoutMs);
    }

    return new OllamaProvider(cfg.baseUrl, cfg.model, timeoutMs);
  }

  public getSnapshotConfig(): ProviderSettings {
    return this._settings.getProvider();
  }
}
