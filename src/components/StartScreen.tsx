/** Shown when no project is open: create (asks for a folder every time) or open. */
import { Clapperboard, FolderOpen, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { createProject, openProject, useSessionUi } from "../project/session";
import { Button, Field, INPUT_CLASS } from "./ui";

export function StartScreen() {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const busy = useSessionUi((s) => s.busy);
  const trimmed = title.trim();

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (trimmed !== "") void createProject(trimmed);
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-[520px] space-y-6">
        <div className="flex items-center gap-3">
          <Clapperboard size={32} strokeWidth={1.75} className="text-accent" aria-hidden />
          <div>
            <h1 className="text-[18px] leading-[26px] font-semibold">Script Studio</h1>
            <p className="text-[13px] text-fg-2">Editor video tutorial berbasis naskah.</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-lg border border-line-subtle bg-panel p-4">
          <h2 className="panel-title">Proyek baru</h2>
          <Field id={titleId} label="Judul proyek" hint="Anda akan diminta memilih folder tempat proyek disimpan.">
            <input
              id={titleId}
              className={INPUT_CLASS}
              value={title}
              maxLength={255}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="mis. Tutorial Login SUMBA"
            />
          </Field>
          <Button type="submit" variant="primary" icon={Plus} disabled={trimmed === ""} loading={busy}>
            Buat proyek
          </Button>
        </form>

        <div className="flex items-center justify-between rounded-lg border border-line-subtle bg-panel p-4">
          <div>
            <h2 className="panel-title">Buka proyek</h2>
            <p className="mt-1 text-[12px] text-fg-2">Pilih folder berakhiran .smbproj.</p>
          </div>
          <Button icon={FolderOpen} onClick={() => void openProject()} loading={busy}>
            Buka proyek
          </Button>
        </div>
      </div>
    </div>
  );
}
