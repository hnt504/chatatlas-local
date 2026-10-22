// Made-up exports in the shapes ChatGPT and Claude send, with the awkward parts real ones have:
// regenerated answers (branches), hidden system messages, tool calls, answers in several parts,
// pictures, thinking blocks, an empty chat, accents.

export const chatgptExport = [
  {
    id: 'c-garden',
    conversation_id: 'c-garden',
    title: 'Planning the vegetable garden',
    create_time: 1754006400, // 2025-08-01
    update_time: 1754010000,
    current_node: 'n5',
    mapping: {
      root: { id: 'root', parent: null, children: ['n0'], message: null },
      n0: {
        id: 'n0',
        parent: 'root',
        children: ['n1'],
        message: { author: { role: 'system' }, content: { content_type: 'text', parts: [''] }, metadata: { is_visually_hidden_from_conversation: true } },
      },
      n1: {
        id: 'n1',
        parent: 'n0',
        children: ['n2', 'n2b'],
        message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['What should I plant in raised beds in zone 6?'] } },
      },
      // The first answer, regenerated: not on the path to current_node.
      n2b: {
        id: 'n2b',
        parent: 'n1',
        children: [],
        message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['An OLD answer about cucumbers.'] } },
      },
      n2: {
        id: 'n2',
        parent: 'n1',
        children: ['n3'],
        message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Tomatoes, peppers and kale do well in zone 6 raised beds.'] } },
      },
      n3: {
        id: 'n3',
        parent: 'n2',
        children: ['n4'],
        message: { author: { role: 'tool', name: 'browser' }, content: { content_type: 'text', parts: ['(search results)'] } },
      },
      n4: {
        id: 'n4',
        parent: 'n3',
        children: ['n5'],
        message: {
          author: { role: 'user' },
          content: {
            content_type: 'multimodal_text',
            parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://x' }, 'Here is a photo of the bed. Is the soil too sandy?'],
          },
        },
      },
      n5: {
        id: 'n5',
        parent: 'n4',
        children: [],
        message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['It looks sandy; mix in compost before planting.'] } },
      },
    },
  },
  {
    id: 'c-cafe',
    title: 'Café names',
    create_time: 1767225600, // 2026-01-01
    update_time: 1767229200,
    current_node: 'b3',
    mapping: {
      b1: {
        id: 'b1',
        parent: null,
        children: ['b2'],
        message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Ideas for a café name near the lighthouse?'] } },
      },
      b2: {
        id: 'b2',
        parent: 'b1',
        children: ['b3'],
        message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['The Lamp Room, '] } },
      },
      b3: {
        id: 'b3',
        parent: 'b2',
        children: [],
        message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Keeper’s Brew, Beacon Beans.'] } },
      },
    },
  },
  {
    id: 'c-empty',
    title: 'Nothing said',
    create_time: 1767225600,
    current_node: 'e1',
    mapping: { e1: { id: 'e1', parent: null, children: [], message: { author: { role: 'system' }, content: { parts: [''] } } } },
  },
];

export const claudeExport = [
  {
    uuid: '3f1b2c4d-0000-4000-8000-000000000001',
    name: 'Résumé for the bakery job',
    created_at: '2026-03-10T15:00:00.000000Z',
    updated_at: '2026-03-10T15:20:00.000000Z',
    chat_messages: [
      {
        uuid: 'm1',
        sender: 'human',
        text: 'Help me tighten my résumé for a bakery manager role.',
        content: [{ type: 'text', text: 'Help me tighten my résumé for a bakery manager role.' }],
      },
      {
        uuid: 'm2',
        sender: 'assistant',
        text: '',
        content: [
          { type: 'thinking', thinking: 'secret reasoning' },
          { type: 'text', text: 'Lead with the sourdough program you started.' },
          { type: 'tool_use', name: 'web_search', input: {} },
          { type: 'text', text: 'Then the 20% waste cut.' },
        ],
      },
    ],
  },
  {
    uuid: '3f1b2c4d-0000-4000-8000-000000000002',
    name: '',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:05:00Z',
    chat_messages: [
      { sender: 'human', text: 'What rhymes with orange?' },
      { sender: 'assistant', text: 'Nothing perfectly; "door hinge" comes close.' },
    ],
  },
];

export const chatatlasBackup = {
  exportedAt: '2026-10-20T00:00:00Z',
  source: 'ChatAtlas',
  version: 1,
  platformFilter: 'all',
  count: 1,
  conversations: [
    {
      id: 'gem-77',
      platform: 'gemini',
      title: 'Trip to Lisbon',
      preview: 'Three days in Lisbon',
      date: '2026-05-02T10:00:00Z',
      tags: ['travel'],
      messages: [
        { role: 'user', content: 'Three days in Lisbon in May: what should I see?' },
        { role: 'assistant', content: 'Alfama, Belém and a day trip to Sintra.' },
      ],
    },
  ],
};
