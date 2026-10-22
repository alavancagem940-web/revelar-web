# Revelar (iPhone)

Companheiro **PWA** do app de computador Revelar: aprimora fotos e vídeos **no iPhone**, pelo Safari, com ícone na Tela de Início. Interface em português, modo escuro. Sem login, sem nuvem e sem marca d’água.

Este repositório é só a versão web. O desktop Python fica em [alavancagem940-web/revelar](https://github.com/alavancagem940-web/revelar) e **não** mistura com o TrilhaPy nem com o Inglês Real.

## Abrir no iPhone

- App: https://alavancagem940-web.github.io/revelar-web/
- Instalar (perfil): https://alavancagem940-web.github.io/revelar-web/instalar.html

No Safari, toque **Instalar agora** → **Permitir** → **Ajustes** → **Perfil baixado** → **Instalar**. O iPhone avisa que o perfil não é da App Store: é um Web Clip em tela cheia, o mesmo fluxo do TrilhaPy.

Outro caminho: Safari → Compartilhar → Adicionar à Tela de Início.

## O que ele faz

- Abre **JPG, PNG, HEIC** (galeria ou câmera) e **MP4 / MOV**.
- Fotos: exposição automática, contraste adaptativo (CLAHE no canvas), balanço de branco, nitidez (unsharp mask) e redução de ruído. O trabalho pesado roda num **Web Worker** para a tela não congelar.
- HEIC: o Safari do iPhone decodifica nativo. Outros navegadores de computador podem recusar HEIC — nesse caso o status avisa.
- Vídeos: equalização de cor e estabilização leve. Clipe curto (cerca de 10 s no iPhone) para caber na memória. O Safari tenta exportar **MP4 H.264 + AAC**. Se o aparelho não encodar H.264, o app exporta uma **sequência JPEG em ZIP**, com status honesto, ainda assim salva pelo compartilhar / Arquivos.
- Controles: **Aplicar automático**, **intensidade**, **comparar**, **desfazer**, **exportar**.
- Nomes: `revelar-foto-001.jpg` e `revelar-video-001.mp4` (ou `revelar-video-001-quadros.zip`).

O motor é **canvas + worker**, não OpenCV.js: o WASM do OpenCV estoura memória no Safari iOS. O resultado visual segue o mesmo pipeline do desktop (ruído → branco → exposição → CLAHE → nitidez).

## Como executar localmente

Requisitos: Node.js 22+.

```bash
npm install
npm test
npm run dev
```

Abre em http://127.0.0.1:44217/ . Para o build estático (como no GitHub Pages):

```bash
VITE_BASE=/revelar-web/ npm run build
npm run preview
```

O GitHub Pages usa o fluxo em `.github/workflows/github-pages.yml`.

## Arquivos no iPhone

Depois de **Exportar**, escolha **Salvar em Arquivos** ou **Salvar no Fotos** na folha de compartilhar. JPEG/PNG sRGB e MP4 H.264/AAC abrem no Fotos. A sequência JPEG (ZIP) abre no app Arquivos.

Não há IPA nem App Store. O perfil só coloca o atalho.

## Estrutura

- `src/App.tsx` — fila, pré-visualização, controles
- `src/lib/photo-engine.ts` — pipeline de foto (testável sem DOM)
- `src/workers/enhance.worker.ts` — worker da revelação
- `src/lib/video-engine.ts` — equalização, estabilização leve, MediaRecorder
- `src/lib/export.ts` — JPEG/PNG, MP4, ZIP, compartilhar
- `public/instalar.html` e `public/revelar.mobileconfig` — Web Clip

## Licença

Uso livre para o dono do repositório. Sem “alavancagem” na interface, no perfil ou nos arquivos exportados.
