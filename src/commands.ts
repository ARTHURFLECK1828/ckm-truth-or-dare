export const SLASH_COMMANDS = [
  {
    name: 'truth',
    description: 'Get a Truth question',
    type: 1,
    contexts: [0],
  },
  {
    name: 'dare',
    description: 'Get a Dare question/challenge',
    type: 1,
    contexts: [0],
  },
  {
    name: 'random',
    description: 'Get a random Truth or Dare question',
    type: 1,
    contexts: [0],
  },
  {
    name: 'wouldyourather',
    description: 'Get a Would You Rather question',
    type: 1,
    contexts: [0],
  },
  {
    name: 'addprompt',
    description: 'Add a Truth, Dare, or Would You Rather question for this server',
    type: 1,
    contexts: [0],
    options: [
      {
        name: 'type',
        description: 'Question type',
        type: 3,
        required: true,
        choices: [
          { name: 'Truth', value: 'truth' },
          { name: 'Dare', value: 'dare' },
          { name: 'Would You Rather', value: 'wyr' },
        ],
      },
      {
        name: 'text',
        description: 'The question or dare text',
        type: 3,
        required: true,
        min_length: 5,
        max_length: 500,
      },
    ],
  },
  {
    name: 'leaderboard',
    description: 'Show who answered the most Truth or Dare questions in this server',
    type: 1,
    contexts: [0],
  },
];
