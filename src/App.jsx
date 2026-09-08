import { useEffect, useState } from 'react';
import VRExperience from './vr/VRExperience';
import { loadZones } from './utils/api';

/**
 * The whole app: load the bundled Chennai zones, then hand them to the WebXR
 * scene. There is no screen behind the hologram — you start on the globe.
 */
export default function App() {
  const [zones, setZones] = useState(null);
  const [error, setError] = useState('');
  const [xrSupported, setXrSupported] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    loadZones(abort.signal)
      .then((list) => {
        if (abort.signal.aborted) return;
        if (!list.length) throw new Error('The bundled zone model is empty.');
        setZones(list);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    let alive = true;
    navigator.xr
      ?.isSessionSupported('immersive-vr')
      .then((ok) => { if (alive) setXrSupported(ok); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (error) return <div className="boot boot-error">Could not start: {error}</div>;
  if (!zones) return <div className="boot">Loading the Chennai zone model…</div>;

  return <VRExperience zones={zones} supported={xrSupported} />;
}
