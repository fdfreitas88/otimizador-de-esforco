# Otimizador de esforço

Um mod para o Claude Code. Antes de o Claude começar um prompt, uma checagem rápida no Claude Sonnet lê o pedido e decide duas coisas:

1. **O nível de esforço** de que ele precisa: Baixo, Médio, Alto, Extra alto ou Máximo.
2. **Se outro modelo faria melhor**: uma tarefa simples no Fable ou no Opus pode ir para o Sonnet; uma tarefa crítica no Sonnet ou no Haiku pode subir para o Opus ou o Fable.

## Como ele escolhe o esforço

Quatro perguntas, nesta ordem, parando no primeiro sim:

1. **Vai ter vai e volta, ou é uma tarefa simples?** Baixo. Brainstorm, reescritas rápidas, resumos curtos, perguntas simples.
2. **Um erro escondido custaria dinheiro, um cliente, confiança ou uma decisão errada?** Alto. Conferir números, revisar contrato, análise aberta, checagem de fatos.
3. **É um trabalho longo, difícil e crítico que você entrega e sai de perto?** Extra alto. Máximo só quando o prompt pede o trabalho mais profundo possível.
4. **Todo o resto** é Médio.

Aprovações como "sim" ou "pode seguir" mantêm o nível como está.

## Sugestão de modelo

Quando a tarefa cabe num modelo mais leve ou mais forte, o mod pergunta antes de fazer qualquer coisa:

- **Abrir nova sessão no Sonnet com esforço Médio** (por exemplo): o Claude não faz a tarefa aqui. Ele escreve o prompt, abre uma nova sessão no outro modelo e o resultado volta para este chat. No app desktop isso vira uma nova sessão; no terminal, o Claude entrega o prompt pronto e o comando `claude --model ...`.
- **Ficar aqui, mudar para Alto**: segue neste chat, só trocando o esforço.
- **Ficar aqui como está**: nada muda. Um modelo recusado não é oferecido de novo na mesma sessão.

Ele sempre pergunta antes de trocar de modelo, mesmo no modo automático.

## Comandos

- `/otimizador-de-esforco`: mostra o estado (modo, modelo, nível atual).
- `/otimizador-de-esforco suggest`: pergunta antes de mudar o esforço (padrão).
- `/otimizador-de-esforco auto`: ajusta o esforço sozinho.
- `/otimizador-de-esforco models off` ou `models on`: desliga ou liga a sugestão de modelo.
- `/otimizador-de-esforco off` ou `on`: desliga ou liga o mod.

Quando o nível muda (no modo automático, ou assim que você aceita a troca), o mod roda `/effort` antes de o Claude começar e reenvia o seu prompt: o menu de esforço ao lado do nome do modelo já mostra o novo nível. Prompts com anexo ou menção `@arquivo` não podem ser reenviados: esses saem na hora com o nível ajustado pelo mod, o rótulo "Esforço ..." no canto inferior direito mostra o nível real, e o menu acompanha quando a resposta termina.

## Instalação

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install otimizador-de-esforco --marketplace fdfreitas88/otimizador-de-esforco
```

Responda `y` para adicionar o marketplace e escolha o escopo.

Pelo shell:

```bash
claude plugin install otimizador-de-esforco --marketplace fdfreitas88/otimizador-de-esforco
```

No app desktop, onde `/plugin` não roda: clique em + ao lado da caixa do prompt, depois Plugins, Add marketplace com `fdfreitas88/otimizador-de-esforco`, e então Add plugin.

## Custo

Cada prompt faz uma chamada curta ao Claude Sonnet (esforço baixo) para decidir. O prompt só segue depois dela, então há alguns segundos a mais antes de o Claude começar.

---

As quatro perguntas de esforço partem de uma ideia do Ben AI.
