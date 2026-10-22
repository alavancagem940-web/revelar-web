# Revelar (iPhone)

Companheiro **PWA** do app de computador Revelar: aprimora fotos e vídeos **no iPhone**, pelo Safari, com ícone na Tela de Início. Interface em português, modo escuro. Sem login, sem nuvem e sem marca d’água.

**100% automático:** você escolhe o arquivo e o tratamento profissional começa sozinho. Sem slider, sem exposição manual, sem toque em “Aplicar”.

Este repositório é só a versão web. O desktop Python fica em [alavancagem940-web/revelar](https://github.com/alavancagem940-web/revelar) e **não** mistura com o TrilhaPy nem com o Inglês Real.

## Abrir no iPhone

- App: https://alavancagem940-web.github.io/revelar-web/
- Instalar (perfil): https://alavancagem940-web.github.io/revelar-web/instalar.html

No Safari, toque **Instalar agora** → **Permitir** → **Ajustes** → **Perfil baixado** → **Instalar**. O iPhone avisa que o perfil não é da App Store: é um Web Clip em tela cheia, o mesmo fluxo do TrilhaPy.

Outro caminho: Safari → Compartilhar → Adicionar à Tela de Início.

## O que ele faz

- Abre **JPG, PNG, HEIC** (galeria ou câmera) e **MP4 / MOV**.
- Assim que o arquivo entra, o worker aplica o look **punch**: pretos/brancos automáticos, CLAHE no L* do LAB, unsharp de alta frequência (microtextura) e um pouco de balanço de branco. Sem slider e sem “Aplicar”.
- **Recuperação:** primeiro suaviza artefatos de compressão (deblock), depois **upscale Lanczos** em fotos pequenas ou moles (nunca reduz uma foto já boa), e só então o realce de textura. JPEG ruim vira padrão bar; foto boa não vira papa.
- Processa e exporta sem downscale. JPEG qualidade 0,95 ou PNG se a origem for PNG.
- Tela: **antes/depois**, escolher arquivo, barra de progresso, **Exportar** e **Remover imagem** (em cada item da fila, para tirar foto por engano ou duplicada).
- HEIC: o Safari do iPhone decodifica nativo.
- Vídeos: equalização de cor e estabilização leve. Clipe curto (cerca de 10 s no iPhone). O Safari tenta **MP4 H.264 + AAC**; se não encodar, sai uma **sequência JPEG em ZIP**, com status honesto.
- Nomes: `revelar-foto-001.jpg` e `revelar-video-001.mp4`.

O motor é **canvas + worker**, não OpenCV.js.

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

Depois de **Exportar**, escolha **Salvar em Arquivos** ou **Salvar no Fotos**. JPEG sRGB e MP4 H.264/AAC abrem no Fotos.

Não há IPA nem App Store. O perfil só coloca o atalho.

## Estrutura

- `src/App.tsx` — fila, pré-visualização, revelação automática
- `src/lib/photo-engine.ts` — pipeline de foto (punch LAB)
- `src/lib/recovery.ts` — deblock JPEG + upscale Lanczos
- `src/workers/enhance.worker.ts` — worker da revelação
- `src/lib/video-engine.ts` — equalização, estabilização leve, MediaRecorder
- `src/lib/export.ts` — JPEG, MP4, ZIP, compartilhar
- `public/instalar.html` e `public/revelar.mobileconfig` — Web Clip

## Licença

Uso livre para o dono do repositório. Sem “alavancagem” na interface, no perfil ou nos arquivos exportados.
