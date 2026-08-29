import { parseAbi } from 'viem'

export const dayOneAbi = parseAbi([
  'function openRegistry(string name_) returns (uint256)',
  'function rotateCode(uint256 id, bytes32 newCodeHash)',
  'function setGateEnabled(uint256 id, bool enabled)',
  'function join(uint256 id, string code, string handle)',
  'function fund(uint256 id) payable',
  'function freeze(uint256 id)',
  'function payout(uint256 id, uint256 batchSize)',
  'function claimOwed()',
  'function withdrawUnspent(uint256 id)',

  'function nextId() view returns (uint256)',
  'function supporterCount(uint256 id) view returns (uint256)',
  'function totalWeight(uint256 id) view returns (uint256)',
  'function weightOf(uint256 rank) view returns (uint256)',
  'function paidUpTo(uint256 id) view returns (uint256)',
  'function joined(uint256 id, address who) view returns (bool)',
  'function owed(address who) view returns (uint256)',
  'function registries(uint256 id) view returns (address owner, string name, uint64 openedAt, bool open, bool gateEnabled, bytes32 codeHash, bytes32 prevCodeHash, uint256 pot, uint256 unit, uint256 paidOut)',

  'event RegistryOpened(uint256 indexed id, address indexed owner, string name)',
  'event CodeRotated(uint256 indexed id, bytes32 codeHash)',
  'event GateToggled(uint256 indexed id, bool enabled)',
  'event Joined(uint256 indexed id, address indexed who, uint256 rank, uint64 at, string handle)',
  'event Funded(uint256 indexed id, address indexed from, uint256 amount)',
  'event Frozen(uint256 indexed id, uint256 supporters, uint256 unit)',
  'event Paid(uint256 indexed id, address indexed who, uint256 rank, uint256 amount)',
  'event PayoutFailed(uint256 indexed id, address indexed who, uint256 amount)',
])

export function friendlyError(err) {
  const raw = (err?.shortMessage || err?.details || err?.message || String(err)).toLowerCase()

  if (raw.includes('alreadyjoined')) return "You're already on this list."
  if (raw.includes('badcode')) return 'That code expired. Scan the QR on screen again.'
  if (raw.includes('closed')) return 'This list is closed — ranks are already locked.'
  if (raw.includes('handletoolong')) return 'Name is too long (20 characters max).'
  if (raw.includes('notowner')) return 'Only the registry owner can do that.'
  if (raw.includes('notfunded')) return 'Fund the registry before paying out.'
  if (raw.includes('nosupporters')) return 'Nobody has joined yet.'
  if (raw.includes('nothingleft')) return 'Nothing left to do here.'
  if (raw.includes('user rejected') || raw.includes('user denied')) return 'You cancelled it.'
  if (raw.includes('insufficient funds')) return 'Not enough MON for gas. Grab some from faucet.monad.xyz.'
  return err?.shortMessage || err?.message || 'Something went wrong.'
}
