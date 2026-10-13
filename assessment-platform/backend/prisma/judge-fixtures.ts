import type { Difficulty } from '../src/database/generated/client';
export interface JudgeFixture {
  slug: string;
  title: string;
  difficulty: Difficulty;
  topic: string;
  statement: string;
  inputFormat: string;
  constraints: string;
  functionAdapter?: boolean;
  cases: { input: string; output: string }[];
  solution: string;
}
/** Reviewed development data only. Production cases must use separately managed private content. */
export const judgeFixtures: JudgeFixture[] = [
  {
    slug: 'sum-array-function',
    title: 'Array sum',
    difficulty: 'EASY',
    topic: 'Arrays',
    functionAdapter: true,
    statement:
      'Implement solve(nums) and return the sum of the integers. The trusted driver reads a JSON array and prints the returned integer.',
    inputFormat:
      'One JSON array of integers. Implement the function shown in your language template.',
    constraints:
      '0 ≤ array length ≤ 100000; -10^9 ≤ each value ≤ 10^9. Use a 64-bit integer in Java/C++.',
    cases: [
      { input: '[1,2,3]\n', output: '6\n' },
      { input: '[-2,5,0]\n', output: '3\n' },
      { input: '[]\n', output: '0\n' },
      { input: '[0]\n', output: '0\n' },
      { input: '[-5,-8]\n', output: '-13\n' },
      { input: '[1000000000,1000000000,1000000000,1000000000]\n', output: '4000000000\n' },
    ],
    solution: 'def solve(nums):\n    return sum(nums)\n',
  },
  {
    slug: 'maximum-element',
    title: 'Maximum element',
    difficulty: 'EASY',
    topic: 'Arrays',
    statement: 'Print the largest value in an array of integers.',
    inputFormat: 'n on the first line, then n space-separated integers.',
    constraints: '1 ≤ n ≤ 100000; -10^9 ≤ each value ≤ 10^9.',
    cases: [
      { input: '3\n1 8 3\n', output: '8\n' },
      { input: '1\n-7\n', output: '-7\n' },
      { input: '3\n-8 -1 -3\n', output: '-1\n' },
      { input: '4\n4 4 4 4\n', output: '4\n' },
      { input: '2\n1000000000 -1000000000\n', output: '1000000000\n' },
      { input: '4\n0 -1 -2 -3\n', output: '0\n' },
    ],
    solution: 'import sys\na=list(map(int,sys.stdin.read().split()))\nprint(max(a[1:]))\n',
  },
  {
    slug: 'count-even',
    title: 'Count even values',
    difficulty: 'EASY',
    topic: 'Arrays',
    statement: 'Count the even integers in the array, including zero and negative even values.',
    inputFormat: 'n followed by n integers.',
    constraints: '0 ≤ n ≤ 100000; -10^9 ≤ each value ≤ 10^9.',
    cases: [
      { input: '4\n1 2 3 4\n', output: '2\n' },
      { input: '3\n-2 -4 1\n', output: '2\n' },
      { input: '0\n', output: '0\n' },
      { input: '3\n1 3 5\n', output: '0\n' },
      { input: '1\n0\n', output: '1\n' },
      { input: '4\n2 4 6 8\n', output: '4\n' },
    ],
    solution:
      'import sys\na=list(map(int,sys.stdin.read().split()))\nprint(sum(x%2==0 for x in a[1:]))\n',
  },
  {
    slug: 'reverse-string',
    title: 'Reverse a string',
    difficulty: 'EASY',
    topic: 'Strings',
    statement: 'Reverse the given string and print it.',
    inputFormat: 'One line containing lowercase ASCII letters, possibly empty.',
    constraints: '0 ≤ string length ≤ 100000.',
    cases: [
      { input: 'abc\n', output: 'cba\n' },
      { input: 'level\n', output: 'level\n' },
      { input: '\n', output: '\n' },
      { input: 'a\n', output: 'a\n' },
      { input: 'abcdefg\n', output: 'gfedcba\n' },
      { input: 'aaaa\n', output: 'aaaa\n' },
    ],
    solution: 'import sys\nprint(sys.stdin.readline().rstrip("\\n")[::-1])\n',
  },
  {
    slug: 'distinct-substring',
    title: 'Longest distinct substring',
    difficulty: 'MEDIUM',
    topic: 'Sliding window',
    statement: 'Find the length of the longest contiguous substring with no repeated characters.',
    inputFormat: 'One line of lowercase ASCII letters.',
    constraints: '0 ≤ string length ≤ 100000.',
    cases: [
      { input: 'abca\n', output: '3\n' },
      { input: 'bbbbb\n', output: '1\n' },
      { input: '\n', output: '0\n' },
      { input: 'abcdef\n', output: '6\n' },
      { input: 'abba\n', output: '2\n' },
      { input: 'pwwkew\n', output: '3\n' },
    ],
    solution:
      'import sys\ns=sys.stdin.readline().rstrip("\\n")\nlast={}; left=0; best=0\nfor right,ch in enumerate(s):\n    left=max(left,last.get(ch,-1)+1)\n    last[ch]=right\n    best=max(best,right-left+1)\nprint(best)\n',
  },
  {
    slug: 'minimum-coins',
    title: 'Minimum coins',
    difficulty: 'MEDIUM',
    topic: 'Dynamic programming',
    statement:
      'Find the minimum number of coins needed to reach the target. Every denomination may be used any number of times. Print -1 if impossible.',
    inputFormat: 'n and target on the first line, followed by n positive denominations.',
    constraints: '1 ≤ n ≤ 100; 0 ≤ target ≤ 10000; 1 ≤ coin value ≤ 10000.',
    cases: [
      { input: '3 11\n1 2 5\n', output: '3\n' },
      { input: '1 3\n2\n', output: '-1\n' },
      { input: '1 0\n3\n', output: '0\n' },
      { input: '2 6\n4 3\n', output: '2\n' },
      { input: '2 7\n2 4\n', output: '-1\n' },
      { input: '3 10\n1 5 7\n', output: '2\n' },
    ],
    solution:
      'import sys\na=list(map(int,sys.stdin.read().split())); n,t=a[:2]; coins=a[2:]\ndp=[t+1]*(t+1); dp[0]=0\nfor x in range(1,t+1):\n    for c in coins:\n        if c<=x: dp[x]=min(dp[x],dp[x-c]+1)\nprint(dp[t] if dp[t]<=t else -1)\n',
  },
  {
    slug: 'blocked-grid-paths',
    title: 'Paths through a blocked grid',
    difficulty: 'HARD',
    topic: 'Dynamic programming',
    statement:
      'Count paths from the top left to the bottom right using only right and down moves. A # cell is blocked. Print the count modulo 1000000007.',
    inputFormat: 'n and m, followed by n rows of m characters from . and #.',
    constraints: '1 ≤ n,m ≤ 2000; use O(m) additional memory.',
    cases: [
      { input: '2 2\n..\n..\n', output: '2\n' },
      { input: '3 3\n...\n.#.\n...\n', output: '2\n' },
      { input: '1 1\n.\n', output: '1\n' },
      { input: '1 1\n#\n', output: '0\n' },
      { input: '3 3\n...\n...\n...\n', output: '6\n' },
      { input: '4 4\n....\n....\n....\n....\n', output: '20\n' },
    ],
    solution:
      'import sys\nn,m=map(int,sys.stdin.readline().split()); dp=[0]*m; dp[0]=1\nfor _ in range(n):\n    row=sys.stdin.readline().strip()\n    for j in range(m):\n        if row[j]=="#": dp[j]=0\n        elif j: dp[j]=(dp[j]+dp[j-1])%1000000007\nprint(dp[-1])\n',
  },
  {
    slug: 'weighted-intervals',
    title: 'Maximum compatible job profit',
    difficulty: 'HARD',
    topic: 'Dynamic programming',
    statement:
      'Select non-overlapping jobs to maximize total profit. A job ending at time t is compatible with one starting at t.',
    inputFormat: 'n followed by n lines containing start, end, profit.',
    constraints: '1 ≤ n ≤ 200000; 0 ≤ start < end ≤ 10^9; 1 ≤ profit ≤ 10^9. Use a 64-bit result.',
    cases: [
      { input: '3\n1 2 50\n2 4 10\n1 4 70\n', output: '70\n' },
      { input: '4\n1 3 50\n2 4 10\n3 5 40\n5 7 20\n', output: '110\n' },
      { input: '1\n0 1 5\n', output: '5\n' },
      { input: '3\n1 4 10\n2 5 20\n3 6 30\n', output: '30\n' },
      { input: '3\n0 1 2\n1 2 3\n2 3 4\n', output: '9\n' },
      { input: '4\n1 4 20\n2 3 40\n3 4 40\n4 5 10\n', output: '90\n' },
    ],
    solution:
      'import sys,bisect\na=list(map(int,sys.stdin.read().split())); jobs=sorted([tuple(a[i:i+3]) for i in range(1,len(a),3)],key=lambda x:x[1]); ends=[]; dp=[0]\nfor s,e,p in jobs:\n    j=bisect.bisect_right(ends,s)\n    dp.append(max(dp[-1],dp[j]+p)); ends.append(e)\nprint(dp[-1])\n',
  },
];
export function starterTemplate(language: 'PYTHON' | 'JAVA' | 'CPP', functionAdapter = false) {
  if (!functionAdapter)
    return {
      executionAdapter: { kind: 'STDIO' },
      starterCode: {
        PYTHON: "# Read this problem's input format from stdin and write the answer to stdout.\n",
        JAVA: 'import java.io.*;\nimport java.util.*;\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        // Read stdin and write stdout.\n    }\n}\n',
        CPP: '#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n    ios::sync_with_stdio(false); cin.tie(nullptr);\n    // Read stdin and write stdout.\n    return 0;\n}\n',
      }[language],
    };
  if (language === 'PYTHON')
    return {
      starterCode: 'def solve(nums):\n    # Return the array sum.\n    return 0\n',
      executionAdapter: {
        kind: 'SOURCE_WRAPPER',
        prefix: 'import json, sys',
        suffix: 'print(solve(json.loads(sys.stdin.read())))',
      },
    };
  if (language === 'JAVA')
    return {
      starterCode:
        'static long solve(long[] nums) {\n    // Return the array sum.\n    return 0L;\n}\n',
      executionAdapter: {
        kind: 'SOURCE_WRAPPER',
        prefix: 'import java.io.*;\nimport java.util.*;\npublic class Main {',
        suffix:
          'public static void main(String[] args) throws Exception {\nString s = new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).trim();\ns = s.substring(1, s.length()-1).trim();\nString[] parts = s.isEmpty() ? new String[0] : s.split(",");\nlong[] nums = new long[parts.length];\nfor (int i=0; i<parts.length; i++) nums[i]=Long.parseLong(parts[i].trim());\nSystem.out.println(solve(nums));\n}\n}',
      },
    };
  return {
    starterCode:
      'long long solve(vector<long long> nums) {\n    // Return the array sum.\n    return 0;\n}\n',
    executionAdapter: {
      kind: 'SOURCE_WRAPPER',
      prefix: '#include <bits/stdc++.h>\nusing namespace std;',
      suffix:
        "int main() {\nstring s; getline(cin,s);\nfor (char &c : s) if (c=='[' || c==']' || c==',') c=' ';\nistringstream in(s); vector<long long> nums; long long x;\nwhile (in>>x) nums.push_back(x);\ncout << solve(nums) << \"\\n\";\n}",
    },
  };
}
