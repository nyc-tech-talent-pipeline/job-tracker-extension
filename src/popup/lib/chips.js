export const ROLE_INTERVIEW_TYPES = {
  'Software Engineer': ['Live Coding', 'System Design', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'Frontend Engineer': ['Live Coding', 'UI Challenge', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'Backend Engineer': ['Live Coding', 'System Design', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'Full Stack Engineer': ['Live Coding', 'System Design', 'UI Challenge', 'Technical Screen', 'Behavioral'],
  'Mobile Engineer': ['Live Coding', 'System Design', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'DevOps / Cloud Engineer': ['Infrastructure Design', 'Scripting Challenge', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'QA / Test Engineer': ['Test Case Design', 'Bug Analysis', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'Embedded Systems Engineer': ['Live Coding', 'Hardware Design', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'Data Analyst': ['SQL Test', 'Case Study', 'Data Challenge', 'Technical Screen', 'Behavioral'],
  'Data Scientist': ['SQL Test', 'Modeling Challenge', 'Statistics Test', 'Take-Home', 'Behavioral'],
  'Data Engineer': ['SQL Test', 'Pipeline Design', 'Technical Screen', 'Take-Home', 'Behavioral'],
  'Machine Learning Engineer': ['ML Design', 'Coding Challenge', 'Statistics Test', 'Take-Home', 'Behavioral'],
  'Business Intelligence Analyst': ['SQL Test', 'Dashboard Challenge', 'Case Study', 'Technical Screen', 'Behavioral'],
  'Product Manager': ['Product Case', 'Metrics Question', 'Strategy', 'Take-Home', 'Behavioral'],
  'UX/UI Designer': ['Portfolio Review', 'Design Challenge', 'Critique', 'Take-Home', 'Behavioral'],
  'UX Researcher': ['Research Plan', 'Case Study', 'Portfolio Review', 'Take-Home', 'Behavioral'],
  'Product Designer': ['Portfolio Review', 'Design Challenge', 'Critique', 'Take-Home', 'Behavioral'],
  'Business Analyst': ['Case Study', 'SQL Test', 'Data Challenge', 'Take-Home', 'Behavioral'],
  'Operations Analyst': ['Case Study', 'Process Design', 'Data Challenge', 'Take-Home', 'Behavioral'],
  'Program Coordinator': ['Scenario', 'Case Study', 'Presentation', 'Take-Home', 'Behavioral'],
  'Project Manager': ['Scenario', 'Case Study', 'Presentation', 'Take-Home', 'Behavioral'],
  'Strategy & Operations': ['Case Study', 'Metrics Question', 'Strategy', 'Take-Home', 'Behavioral'],
  'Cybersecurity Analyst': ['Threat Analysis', 'Technical Screen', 'CTF Challenge', 'Take-Home', 'Behavioral'],
  'IT Support / Systems Admin': ['Troubleshooting', 'Technical Screen', 'Scenario', 'Behavioral'],
  'Technical Writer': ['Writing Sample', 'Portfolio Review', 'Edit Test', 'Take-Home', 'Behavioral'],
  'Solutions Engineer': ['Technical Demo', 'Live Coding', 'System Design', 'Behavioral'],
  'Research Scientist': ['Research Presentation', 'Technical Screen', 'Paper Review', 'Take-Home', 'Behavioral'],
  Other: ['Technical Screen', 'Case Study', 'Presentation', 'Take-Home', 'Behavioral']
};

export const ROLE_TYPE_GROUPS = [
  {
    label: 'Engineering',
    options: ['Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Engineer', 'Mobile Engineer', 'DevOps / Cloud Engineer', 'QA / Test Engineer', 'Embedded Systems Engineer']
  },
  {
    label: 'Data',
    options: ['Data Analyst', 'Data Scientist', 'Data Engineer', 'Machine Learning Engineer', 'Business Intelligence Analyst']
  },
  {
    label: 'Product & Design',
    options: ['Product Manager', 'UX/UI Designer', 'UX Researcher', 'Product Designer']
  },
  {
    label: 'Business & Operations',
    options: ['Business Analyst', 'Operations Analyst', 'Program Coordinator', 'Project Manager', 'Strategy & Operations']
  },
  {
    label: 'Other Tech-Adjacent',
    options: ['Cybersecurity Analyst', 'IT Support / Systems Admin', 'Technical Writer', 'Solutions Engineer', 'Research Scientist']
  }
];

export const DS_CHIPS = ['Arrays', 'Strings', 'Linked Lists', 'Doubly Linked Lists', 'Stacks', 'Queues', 'Deques', 'Hash Maps', 'Hash Sets', 'Trees', 'Binary Trees', 'Binary Search Trees', 'AVL Trees', 'Red-Black Trees', 'Segment Trees', 'Fenwick Trees', 'Heaps', 'Min Heap', 'Max Heap', 'Priority Queues', 'Graphs', 'Directed Graphs', 'Weighted Graphs', 'Tries', 'Matrices', 'Monotonic Stack', 'Monotonic Queue', 'Disjoint Sets', 'Bloom Filters', 'LRU Cache'];
export const ALGO_CHIPS = ['Two Pointers', 'Fast & Slow Pointers', 'Sliding Window', 'Binary Search', 'BFS', 'DFS', 'Recursion', 'Backtracking', 'Dynamic Programming', 'Memoization', 'Tabulation', 'Greedy', 'Divide & Conquer', 'Merge Sort', 'Quick Sort', 'Heap Sort', 'Counting Sort', 'Radix Sort', 'Topological Sort', "Dijkstra's", 'Bellman-Ford', 'Floyd-Warshall', "Prim's", "Kruskal's", 'Bit Manipulation', 'Math & Number Theory', 'Prefix Sum', 'Difference Array', 'Intervals', 'Cyclic Sort', 'Reservoir Sampling', 'Fisher-Yates Shuffle'];
export const SYS_CHIPS = ['Load Balancing', 'Caching', 'Sharding', 'Replication', 'CAP Theorem', 'Consistent Hashing', 'Message Queues', 'Rate Limiting', 'CDN', 'SQL vs NoSQL', 'Microservices', 'API Design', 'WebSockets', 'Pub/Sub'];
