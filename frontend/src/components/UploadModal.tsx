import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FileText, UploadCloud, X, ShieldCheck } from 'lucide-react';
import { api, errorText } from '../api';
import { bytes } from '../domain';
import { keys } from '../queries';
import { Button, Modal, useToast } from './ui';

export const MAX_UPLOAD_BYTES = 10_000_000;
export function UploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState('');
  const [dragging, setDragging] = useState(false);
  const key = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const upload = useMutation({
    mutationFn: ({ file, key }: { file: File; key: string }) => api.upload(file, key),
    retry: false,
    onSuccess: job => {
      client.setQueryData(keys.job(job.id), job);
      void client.invalidateQueries({ queryKey: keys.jobs });
      onClose();
      navigate('/analyses/' + job.id);
      toast('Dosya kaydedildi. Analizin durumunu buradan takip edebilirsiniz.');
    },
  });
  function choose(files: FileList | null) {
    if (upload.isPending || !files?.length) return;
    upload.reset(); setFile(null); setLocalError(''); key.current = '';
    if (files.length !== 1) { setLocalError('Lütfen tek bir dosya seçin.'); return; }
    const selected = files[0];
    if (selected.size === 0) { setLocalError('Dosya boş. Lütfen log içeren bir dosya seçin.'); return; }
    if (selected.size > MAX_UPLOAD_BYTES) { setLocalError('Dosya 10 MB sınırını aşıyor.'); return; }
    setFile(selected); key.current = crypto.randomUUID();
  }
  return <Modal title="Yeni analiz" onClose={onClose} busy={upload.isPending}>
    <form onSubmit={event => { event.preventDefault(); if (file) upload.mutate({ file, key: key.current }); }}>
      <div className="modal-body">
        <p className="modal-intro">Log dosyanızı yükleyin. Benzer kayıtlar gruplanır, olaylar ve olası kök nedenler analiz edilir.</p>
        <input ref={input} type="file" className="file-input" tabIndex={-1} aria-label="Log dosyası"
          accept=".log,.txt,.out,text/plain" disabled={upload.isPending} onChange={event => choose(event.target.files)} />
        <div className={'dropzone ' + (dragging ? 'dropzone-active ' : '') + (file ? 'dropzone-selected' : '')}
          onDragOver={event => { event.preventDefault(); if (!upload.isPending) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files); }}>
          {file ? <div className="file-picked"><div className="file-glyph"><FileText size={24} /></div><div className="file-picked-name"><strong>{file.name}</strong><span>{bytes(file.size)} · Yüklemeye hazır</span></div>
            <button type="button" className="icon-button" disabled={upload.isPending} aria-label="Seçilen dosyayı kaldır" onClick={() => { setFile(null); upload.reset(); if (input.current) input.current.value = ''; }}><X size={18} /></button></div>
            : <><div className="upload-glyph"><UploadCloud size={28} /></div><strong>Dosyanızı buraya sürükleyin</strong><span>veya bilgisayarınızdan seçin</span></>}
          <Button type="button" variant="secondary" data-autofocus disabled={upload.isPending} onClick={() => input.current?.click()}>{file ? 'Dosyayı değiştir' : 'Dosya seç'}</Button>
          <small>Hadoop biçiminde UTF-8 log · En fazla 10 MB</small>
        </div>
        {(localError || upload.error) && <div className="inline-error" role="alert">{localError || errorText(upload.error)}</div>}
        <div className="upload-note"><ShieldCheck size={18} aria-hidden="true" /><p>Yükleme tamamlandıktan sonra analiz kaydedilir. İşlenirken sayfayı kapatabilir, daha sonra geri dönebilirsiniz.</p></div>
      </div>
      <footer className="modal-footer"><Button type="button" variant="ghost" disabled={upload.isPending} onClick={onClose}>Vazgeç</Button>
        <Button type="submit" disabled={!file} busy={upload.isPending}><UploadCloud size={16} aria-hidden="true" />{upload.isPending ? 'Dosya yükleniyor…' : 'Analizi başlat'}</Button></footer>
    </form>
  </Modal>;
}

