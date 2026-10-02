import type { ConnectionInfo } from '../messaging/protocol';
import type { ProviderService } from './ProviderService';
import type { SettingsService } from '../services/SettingsService';

/**
 * Tracks provider connectivity without blocking the extension host.
 * `refresh()` probes the provider (ping) and reports capability + connection state.
 */
export class ConnectionManager {
  private _snapshot: ConnectionInfo = {
    provider: 'ollama',
    model: '',
    baseUrl: '',
    connected: false,
    supportsTools: false,
    supportsStreaming: false,
  };
  private _inFlight: Promise<void> | null = null;

  constructor(
    private readonly _providerService: ProviderService,
    private readonly _settings: SettingsService
  ) {}

  public getSnapshot(): ConnectionInfo {
    return { ...this._snapshot };
  }

  /** De-duped, non-blocking connectivity refresh. Safe to call repeatedly. */
  public refresh(): Promise<void> {
    if (this._inFlight) {
      return this._inFlight;
    }
    this._inFlight = this._doRefresh().finally(() => {
      this._inFlight = null;
    });
    return this._inFlight;
  }

  private async _doRefresh(): Promise<void> {
    const cfg = this._settings.getProvider();
    const base: ConnectionInfo = {
      provider: cfg.type,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      connected: false,
      supportsTools: false,
      supportsStreaming: false,
    };

    let provider: Awaited<ReturnType<ProviderService['create']>>;
    try {
      provider = await this._providerService.create();
    } catch {
      // Missing API key / bad config: report disconnected with current settings.
      this._snapshot = base;
      return;
    }

    const caps = provider.capabilities();
    let connected = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      connected = await provider.ping(controller.signal);
    } catch {
      connected = false;
    } finally {
      clearTimeout(timer);
    }

    this._snapshot = {
      ...base,
      connected,
      supportsTools: caps.supportsToolCalling,
      supportsStreaming: caps.supportsStreaming,
    };
  }
}
