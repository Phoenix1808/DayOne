// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  DayOne
/// @notice Proof of who backed you first, and payouts that reach them directly.
contract DayOne {

    struct Registry {
        address owner;
        string  name;
        uint64  openedAt;
        bool    open;          // true = joining allowed, false = ranks frozen
        bool    gateEnabled;   // kill switch for the rotating code
        bytes32 codeHash;      // current valid code
        bytes32 prevCodeHash;  // previous code, still accepted
        uint256 pot;           // total funded
        uint256 unit;          // wei per weight point, fixed at freeze
        uint256 paidOut;       // how much has left the pot
    }

    struct Entry {
        address who;
        uint64  at;
    }

    uint256 public nextId = 1;

    mapping(uint256 => Registry) public registries;
    mapping(uint256 => Entry[])  public entries;                       // index = rank - 1
    mapping(uint256 => mapping(address => bool)) public joined;
    mapping(uint256 => uint256) public paidUpTo;                       // batch cursor
    mapping(address => uint256) public owed;                           // failed transfers

    event RegistryOpened(uint256 indexed id, address indexed owner, string name);
    event CodeRotated(uint256 indexed id, bytes32 codeHash);
    event GateToggled(uint256 indexed id, bool enabled);
    event Joined(uint256 indexed id, address indexed who, uint256 rank, uint64 at, string handle);
    event Funded(uint256 indexed id, address indexed from, uint256 amount);
    event Frozen(uint256 indexed id, uint256 supporters, uint256 unit);
    event Paid(uint256 indexed id, address indexed who, uint256 rank, uint256 amount);
    event PayoutFailed(uint256 indexed id, address indexed who, uint256 amount);

    error NotOwner();
    error Closed();
    error AlreadyJoined();
    error BadCode();
    error HandleTooLong();
    error NoSupporters();
    error NotFunded();
    error NothingLeft();
    error StillOpen();
    error NotFinished();

    modifier onlyOwner(uint256 id) {
        if (msg.sender != registries[id].owner) revert NotOwner();
        _;
    }

    //  create

    function openRegistry(string calldata name_) external returns (uint256 id) {
        id = nextId++;
        Registry storage r = registries[id];
        r.owner    = msg.sender;
        r.name     = name_;
        r.openedAt = uint64(block.timestamp);
        r.open     = true;
        emit RegistryOpened(id, msg.sender, name_);
    }

    //  the gate

    /// @notice Store the hash of the new code. The previous one stays valid,
    ///         so a join submitted near a rotation boundary never fails.
    function rotateCode(uint256 id, bytes32 newCodeHash) external onlyOwner(id) {
        Registry storage r = registries[id];
        r.prevCodeHash = r.codeHash;
        r.codeHash     = newCodeHash;
        r.gateEnabled  = true;
        emit CodeRotated(id, newCodeHash);
    }

    /// @notice Kill switch. If rotation breaks on stage, turn the gate off.
    function setGateEnabled(uint256 id, bool enabled) external onlyOwner(id) {
        registries[id].gateEnabled = enabled;
        emit GateToggled(id, enabled);
    }

    //  join

    function join(uint256 id, string calldata code, string calldata handle) external {
        Registry storage r = registries[id];
        if (!r.open)                    revert Closed();
        if (joined[id][msg.sender])     revert AlreadyJoined();
        if (bytes(handle).length > 20)  revert HandleTooLong();

        if (r.gateEnabled) {
            bytes32 h = keccak256(abi.encodePacked(code));
            if (h != r.codeHash && h != r.prevCodeHash) revert BadCode();
        }

        joined[id][msg.sender] = true;
        entries[id].push(Entry(msg.sender, uint64(block.timestamp)));

        emit Joined(id, msg.sender, entries[id].length, uint64(block.timestamp), handle);
    }

    // money in

    function fund(uint256 id) external payable {
        registries[id].pot += msg.value;
        emit Funded(id, msg.sender, msg.value);
    }

    //  cohorts

    function weightOf(uint256 rank) public pure returns (uint256) {
        if (rank <= 5)  return 3;   // Row 1
        if (rank <= 15) return 2;   // Row 2
        return 1;                   // Row 3
    }

    function totalWeight(uint256 id) public view returns (uint256 w) {
        uint256 n = entries[id].length;
        for (uint256 i = 0; i < n; i++) w += weightOf(i + 1);
    }

    function supporterCount(uint256 id) external view returns (uint256) {
        return entries[id].length;
    }

    //  freeze

    function freeze(uint256 id) external onlyOwner(id) {
        _freeze(id);
    }

    function _freeze(uint256 id) internal {
        Registry storage r = registries[id];
        if (!r.open)      revert Closed();
        if (r.pot == 0)   revert NotFunded();
        uint256 tw = totalWeight(id);
        if (tw == 0)      revert NoSupporters();

        r.open = false;
        r.unit = r.pot / tw;
        emit Frozen(id, entries[id].length, r.unit);
    }

    // pay

    /// @notice Pays the next `batchSize` supporters. Call repeatedly, or
    ///         concurrently, for large registries. Auto-freezes if needed.
    function payout(uint256 id, uint256 batchSize) external onlyOwner(id) {
        Registry storage r = registries[id];
        if (r.open) _freeze(id);

        uint256 i   = paidUpTo[id];
        uint256 n   = entries[id].length;
        uint256 end = i + batchSize > n ? n : i + batchSize;
        if (end <= i) revert NothingLeft();

        for (; i < end; i++) {
            Entry memory e   = entries[id][i];
            uint256 amount   = r.unit * weightOf(i + 1);
            r.paidOut       += amount;

            (bool ok, ) = e.who.call{value: amount, gas: 2300}("");
            if (ok) {
                emit Paid(id, e.who, i + 1, amount);
            } else {
                owed[e.who] += amount;              // never block the batch
                emit PayoutFailed(id, e.who, amount);
            }
        }
        paidUpTo[id] = i;
    }

    /// @notice Fallback for an address that could not receive a push payment.
    function claimOwed() external {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingLeft();
        owed[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "claim failed");
    }

    /// @notice Recover the rounding dust once every batch is done.
    function withdrawUnspent(uint256 id) external onlyOwner(id) {
        Registry storage r = registries[id];
        if (r.open)                                revert StillOpen();
        if (paidUpTo[id] < entries[id].length)     revert NotFinished();

        uint256 amount = r.pot - r.paidOut;
        if (amount == 0) revert NothingLeft();
        r.pot = r.paidOut;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
    }
}
