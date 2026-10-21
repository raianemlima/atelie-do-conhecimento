# Política arquitetural de origem e proveniência

**Projeto:** Ateliê do Conhecimento  
**Status:** decisão obrigatória  
**Escopo:** todo conteúdo utilizado em sínteses, comparações, refinamentos, questões, flashcards e materiais de estudo.

## Princípio central

O Ateliê do Conhecimento não é uma base autônoma de conhecimento. Todo conteúdo utilizado em uma tarefa deve ter origem em documentos e conteúdos expressamente fornecidos e selecionados pela usuária para aquele projeto ou tarefa.

O aplicativo pode organizar, preservar e transformar o material fornecido, mas não pode preencher lacunas com conhecimento implícito do modelo, pesquisa automática ou conteúdo externo não autorizado.

## Regras obrigatórias

1. Não implementar pesquisa automática na internet, recuperação automática de notícias, consulta a bases jurídicas externas ou ingestão autônoma de conteúdo.
2. Não criar nem alimentar uma base de conhecimento própria do aplicativo.
3. Não incorporar conteúdo externo apenas porque o modelo de IA o conhece.
4. Sínteses, refinamentos, comparações e capítulos devem usar exclusivamente as fontes selecionadas pela usuária para o projeto ou tarefa.
5. Cada afirmação factual ou jurídica deve manter referência rastreável ao documento de origem e, quando disponível, à página, seção ou trecho.
6. Fontes insuficientes, contraditórias ou silenciosas devem ser sinalizadas. Lacunas não podem ser preenchidas silenciosamente.
7. É proibido inventar referências, citações, páginas, dispositivos legais ou precedentes.
8. Conhecimento externo somente poderá ser usado quando a usuária o solicitar expressamente em uma tarefa específica. Nesse caso, a origem externa deve ser identificada claramente e o conteúdo não entra automaticamente na biblioteca nem em material definitivo.
9. A usuária controla as fontes utilizadas, as propostas aceitas e o conteúdo que entra em versões aprovadas.
10. O arquivo original deve ser preservado. Texto original, extração, interpretação da IA e conteúdo aprovado pela usuária devem permanecer conceitualmente distintos.

## Consequências para a arquitetura

### Entrada de conteúdo

- A entrada autorizada nesta etapa é a importação explícita de arquivos pela usuária e o cadastro manual de fontes e links.
- Não haverá crawler, busca web, feed de notícias, consulta jurídica automática, sincronização de bases externas ou ingestão em segundo plano.
- Uma URL cadastrada é apenas um registro de referência até que a usuária forneça ou importe o conteúdo correspondente.

### Preservação e extração

- O arquivo original é o artefato de referência e não deve ser substituído pela extração.
- A extração é uma representação derivada e deve manter o vínculo com o documento original.
- Para PDFs, o texto extraído deve conservar a associação com páginas quando essa informação estiver disponível.
- PDF sem camada textual deve ser identificado como não extraído; o aplicativo não deve afirmar que houve leitura de conteúdo visual sem OCR autorizado e implementado.

### Proveniência de afirmações

Qualquer futura operação de síntese ou elaboração deverá conseguir distinguir, no mínimo:

- **Original:** texto preservado do documento fornecido.
- **Extração:** texto obtido mecanicamente do arquivo, incluindo página ou localização quando disponível.
- **Interpretação:** inferência ou proposta produzida pela IA, sempre identificada como tal.
- **Conteúdo aprovado:** texto revisado e aceito pela usuária, com histórico de versão preservado.

Uma afirmação sem fonte suficiente não pode ser apresentada como fato confirmado. Quando houver múltiplas fontes, a rastreabilidade deve permitir apontar convergências, divergências e a fonte de cada trecho relevante.

### Controle da usuária e versões

- Fontes disponíveis para uma tarefa devem ser selecionadas explicitamente pela usuária.
- Uma fonte não selecionada não pode ser usada apenas por estar armazenada na biblioteca.
- Aprovação é uma ação da usuária; automações não podem substituir nem reescrever conteúdo aprovado sem autorização explícita.
- Versões aprovadas devem permanecer recuperáveis, inclusive quando uma nova versão for criada.

## Estado atual e limitações

- A autenticação usa Supabase Auth por sessão, com `@supabase/ssr` e proteção de rotas no proxy.
- Projetos, fontes, capítulos e metadados de documentos são gravados no Supabase com políticas RLS por `auth.uid()`.
- Arquivos originais são enviados somente ao bucket privado `documents`, em caminho particionado pelo usuário. O frontend usa apenas a chave pública/publishable; nenhuma chave secreta é embutida.
- A importação e a extração de PDF/DOCX/Markdown/TXT continuam locais no navegador antes do envio do original e dos metadados.
- Documentos, fontes e capítulos podem ser associados a um projeto; a apostila integrada usa os documentos filtrados pelo projeto ou pela biblioteca selecionada.
- O PDF digitalizado sem camada textual permanece como `no-text`; nenhum OCR é simulado.
- Os dados locais anteriores continuam no navegador até que a usuária execute a migração explícita na tela **Dados e backup**. A migração é aditiva e ignora hashes duplicados.
- O backup ZIP existente ainda é legado local e não exporta nem restaura dados remotos do Supabase. Não há backup remoto automático, criptografia adicional ou sincronização offline nesta etapa.
- Ainda não existe pesquisa web, integração com IA, base remota de conhecimento ou OCR. Esses recursos só poderão ser considerados se forem compatíveis com esta política e se a usuária autorizar explicitamente a tarefa e as fontes envolvidas.

Documentos sensíveis só devem ser usados depois de: aplicar a migração SQL, criar a conta única no Supabase, desativar novos cadastros públicos no painel Auth e confirmar as políticas RLS e do bucket privado.

## Critério de revisão

Qualquer futura alteração que introduza uma fonte, integração, importação ou transformação de conteúdo deve ser revisada contra este documento. Se houver conflito, esta política prevalece sobre conveniência técnica, conhecimento prévio do modelo ou sugestões automáticas.
