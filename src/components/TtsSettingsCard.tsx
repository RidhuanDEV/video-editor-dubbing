/** TTS engine settings (ADR D6): Edge-TTS consent, Azure Speech region + key (stored in the OS keychain). */
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { settingsClearAzure, settingsSetAzure, settingsSetEdgeConsent } from "../lib/ipc";
import { notify } from "../lib/notices";
import { setSettings, useSettings } from "../lib/settings";
import { invalidateVoices } from "../lib/voices";
import { Button, Card, Field, INPUT_CLASS, StatusText } from "./ui";

export function TtsSettingsCard() {
  const ids = { region: useId(), key: useId() };
  const settings = useSettings((s) => s.settings);
  const [region, setRegion] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const setConsent = async (consent: boolean): Promise<void> => {
    const result = await settingsSetEdgeConsent(consent);
    if (!result.ok) return notify("error", result.error.message);
    setSettings(result.value);
    invalidateVoices("edge-tts");
  };

  const saveAzure = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    const result = await settingsSetAzure(region.trim(), key.trim());
    setSaving(false);
    if (!result.ok) return notify("error", `Azure: ${result.error.message}`);
    setKey("");
    setSettings({ edgeTtsConsent: settings?.edgeTtsConsent ?? false, azureRegion: region.trim(), azureKeyStored: true });
    invalidateVoices("azure-speech");
    notify("success", `Azure Speech terhubung (${result.value} suara tersedia). Kunci disimpan di penyimpanan kredensial OS.`);
  };

  const clearAzure = async (): Promise<void> => {
    const result = await settingsClearAzure();
    if (!result.ok) return notify("error", result.error.message);
    setSettings(result.value);
    invalidateVoices("azure-speech");
  };

  return (
    <Card title="Engine suara (TTS)">
      <section className="space-y-2" aria-label="Edge-TTS">
        <h3 className="text-[13px] font-semibold">Edge-TTS (tidak resmi, gratis)</h3>
        <p className="text-[12px] text-fg-2">
          Memakai layanan baca-keras Microsoft Edge lewat klien tidak resmi: teks naskah dikirim ke server Microsoft, layanan dapat berubah atau
          diblokir kapan saja, dan ketentuan penggunaan komersialnya tidak jelas.
        </p>
        {settings?.edgeTtsConsent ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusText tone="success">Disetujui</StatusText>
            <Button onClick={() => void setConsent(false)}>Cabut persetujuan</Button>
          </div>
        ) : (
          <Button icon={ShieldCheck} onClick={() => void setConsent(true)}>
            Saya mengerti, aktifkan Edge-TTS
          </Button>
        )}
      </section>

      <section className="space-y-2 border-t border-line-subtle pt-4" aria-label="Azure Speech">
        <h3 className="text-[13px] font-semibold">Azure AI Speech (resmi, kunci milik Anda)</h3>
        <p className="text-[12px] text-fg-2">
          Disarankan untuk penggunaan komersial. Azure menyediakan kuota gratis bulanan; tagihan di luar kuota menjadi tanggungan pemilik kunci.
          Subtitle untuk scene Azure memakai timing perkiraan (REST tidak memberi waktu per kata).
        </p>
        {settings?.azureKeyStored && settings.azureRegion ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusText tone="success">Terhubung · region {settings.azureRegion}</StatusText>
            <Button icon={Trash2} onClick={() => void clearAzure()}>
              Hapus kunci
            </Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => void saveAzure(e)}>
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Field id={ids.region} label="Region" hint="mis. southeastasia">
                <input id={ids.region} className={`${INPUT_CLASS} font-mono`} value={region} onChange={(e) => setRegion(e.target.value)} spellCheck={false} />
              </Field>
              <Field id={ids.key} label="Kunci (Key 1 atau Key 2)">
                <input id={ids.key} type="password" autoComplete="off" className={`${INPUT_CLASS} font-mono`} value={key} onChange={(e) => setKey(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" icon={KeyRound} loading={saving} disabled={region.trim() === "" || key.trim() === ""}>
              Uji & simpan
            </Button>
          </form>
        )}
      </section>
    </Card>
  );
}
