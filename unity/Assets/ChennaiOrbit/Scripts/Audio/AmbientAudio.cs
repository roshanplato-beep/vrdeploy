using UnityEngine;

namespace ChennaiOrbit.Audio
{
    /// <summary>
    /// Port of <c>src/vr/audio.js</c>: a quiet procedural drone (three sine
    /// partials) plus a short "ping" on interactions. Generated, so there are
    /// no audio files to ship.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public class AmbientAudio : MonoBehaviour
    {
        AudioSource _drone;
        AudioSource _ping;
        bool _enabled;
        double _phase0, _phase1, _phase2;
        int _sampleRate;

        void Awake()
        {
            _sampleRate = AudioSettings.outputSampleRate;

            _drone = GetComponent<AudioSource>();
            _drone.clip = AudioClip.Create("drone", _sampleRate * 2, 1, _sampleRate, true, OnDroneRead);
            _drone.loop = true;
            _drone.spatialBlend = 0f;
            _drone.volume = 0f;

            _ping = gameObject.AddComponent<AudioSource>();
            _ping.playOnAwake = false;
            _ping.spatialBlend = 0f;
        }

        public void Enable()
        {
            _enabled = true;
            if (!_drone.isPlaying) _drone.Play();
            _drone.volume = 0.06f;
        }

        public bool Toggle()
        {
            _enabled = !_enabled;
            _drone.volume = _enabled ? 0.06f : 0f;
            return _enabled;
        }

        public void Ping()
        {
            if (!_enabled) return;
            int len = _sampleRate / 5;
            var data = new float[len];
            for (int i = 0; i < len; i++)
            {
                float t = i / (float)_sampleRate;
                float freq = Mathf.Lerp(680f, 320f, t / (len / (float)_sampleRate));
                float env = Mathf.Exp(-t * 22f);
                data[i] = Mathf.Sin(2f * Mathf.PI * freq * t) * env * 0.5f;
            }
            var clip = AudioClip.Create("ping", len, 1, _sampleRate, false);
            clip.SetData(data, 0);
            _ping.PlayOneShot(clip, 0.4f);
        }

        void OnDroneRead(float[] data)
        {
            double[] freqs = { 110.0, 164.81, 220.0 };
            for (int i = 0; i < data.Length; i++)
            {
                _phase0 += freqs[0] / _sampleRate;
                _phase1 += freqs[1] / _sampleRate;
                _phase2 += freqs[2] / _sampleRate;
                double s = Mathf.Sin((float)(_phase0 * 2 * Mathf.PI))
                         + Mathf.Sin((float)(_phase1 * 2 * Mathf.PI))
                         + Mathf.Sin((float)(_phase2 * 2 * Mathf.PI));
                data[i] = (float)(s / 3.0 * 0.5);
            }
        }
    }
}
