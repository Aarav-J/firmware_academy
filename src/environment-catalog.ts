import { useEffect, useState } from 'react';
import type { CompilerHealth } from './contracts';
import type { ProjectProfile } from './workbench-contracts';
import { DEFAULT_SOURCE } from './examples';
import { apiRequest } from './renode-client';

/** The one environment that always runs client-side, so it's always listed even
 * before the project service responds (and stays listed if that service is down). */
export const PICO_PROFILE: ProjectProfile = {
  id: 'pico', name: 'Pico SDK', board: 'Raspberry Pi Pico', framework: 'Pico SDK · C',
  description: 'RP2040 firmware runs in a browser worker.', available: false, message: 'Connecting to compiler…',
  files: [{ path: 'main.c', content: DEFAULT_SOURCE, editable: true }],
};

/** Live project environments plus compiler health, shared by the project-creation
 * screen (to show what's available before locking one in) and the workbench itself. */
export function useEnvironmentCatalog() {
  const [profiles, setProfiles] = useState<ProjectProfile[]>([PICO_PROFILE]);
  const [health, setHealth] = useState<CompilerHealth | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      const results = await Promise.allSettled([
        apiRequest<ProjectProfile[]>('/api/projects', { signal: controller.signal }),
        apiRequest<CompilerHealth>('/api/health', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (results[0].status === 'fulfilled') {
        setProfiles([PICO_PROFILE, ...results[0].value.filter(item => item.id !== 'pico')]);
        setError('');
      } else setError(results[0].reason instanceof Error ? results[0].reason.message : 'Project service unavailable.');
      setHealth(results[1].status === 'fulfilled' ? results[1].value : null);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  return { profiles, health, error };
}
