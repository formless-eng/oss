// SPDX-License-Identifier: UNLICENSED
// ⣿⣿⣿⣿⣿⠀⠀⣰⣿⣿⣿⣷⡀⠀⠀⣶⣶⣶⣦⡀⠀⠀⠀⣶⣶⡄⠀⠀⣶⣶⡆⠀⠀⣶⣶⠀⠀⠀⠀⢰⣶⣶⣶⣶⢀⠀⠀⣤⣶⣶⣦⡀⠀⠀⠀⣴⣶⣶⣦⠀
// ⣿⣿⠀⠀⠀⠀⠀⣿⣿⠀⢸⣿⡇⠀⠀⣿⣿⠀⢻⣿⠀⠀⠀⣿⣿⣿⠀⢸⣿⣿⡇⠀⠀⣿⣿⠀⠀⠀⠀⢸⣿⡇⠀⠀⠀⠀⢸⣿⡇⠀⣿⣿⠀⠀⣾⣿⠁⠈⣿⡇
// ⣿⣿⠀⠀⠀⠀⠀⣿⣿⠀⢸⣿⡇⠀⠀⣿⣿⠀⣸⣿⠀⠀⠀⣿⣿⣿⡀⣿⡟⣿⡇⠀⠀⣿⣿⠀⠀⠀⠀⢸⣿⡇⠀⠀⠀⠀⠀⣿⣿⡀⠀⠀⠀⠀⠘⣿⣷⠀⠀⠀
// ⣿⣿⠿⠿⠀⠀⠀⣿⣿⠀⢸⣿⡇⠀⠀⣿⣿⣿⣿⡟⠀⠀⠀⣿⣿⣿⣷⣿⠀⣿⡇⠀⠀⣿⣿⠀⠀⠀⠀⢸⣿⡿⠿⠀⠀⠀⠀⠀⢿⣿⣦⠀⠀⠀⠀⠈⣿⣿⡄⠀
// ⣿⣿⠀⠀⠀⠀⠀⣿⣿⠀⢸⣿⡇⠀⠀⣿⣿⠈⣿⣷⠀⠀⠀⣿⣿⢸⣿⣿⠈⣿⡇⠀⠀⣿⣿⠀⠀⠀⠀⢸⣿⡇⠀⠀⠀⠀⢀⣀⠀⠙⣿⣧⠀⠀⣀⣀⠀⠻⣿⡆
// ⣿⣿⠀⠀⠀⠀⠀⢿⣿⣤⣾⣿⠇⠀⠀⣿⣿⠀⣿⣿⠀⠀⠀⣿⣿⠀⣿⡇⠈⣿⡇⠀⠀⣿⣿⣤⣤⡄⠀⢸⣿⣧⣤⣤⡄⠀⢸⣿⣆⠀⣿⣿⠀⠀⣿⣿⡀⢀⣿⣿
// ⠛⠛⠀⠀⠀⠀⠀⠈⠛⠿⠿⠛⠀⠀⠀⠛⠛⠀⠘⠛⠃⠀⠀⠛⠛⠀⠛⠀⠈⠛⠃⠀⠀⠛⠛⠛⠛⠃⠀⠘⠛⠛⠛⠛⠃⠀⠀⠙⠿⠿⠟⠁⠀⠀⠀⠛⠿⠿⠛⠀
// https://formless.xyz/opportunities
//
pragma solidity >=0.8.0 <0.9.0;

import "./libraries/Immutable.sol";
import "./LimitedOwnable.sol";
import "./interfaces/IPFA.sol";
import "./interfaces/IPFACollection.sol";

/// @title Standard pay-for-access (PFA) abstract base.
/// @author brandon@formless.xyz
/// @notice This base contract is a base implementation of the IPFA
/// interface.
abstract contract PFA is IPFA, LimitedOwnable {
    /// @notice Emitted when a successful access grant is awarded
    /// to a recipient address.
    event Grant(address indexed recipient, uint256 indexed tokenId);

    /// @notice Emitted when a successful license grant is awarded
    /// to a recipient (licensee) address.
    event License(address indexed licensee);

    Immutable.UnsignedInt256 internal _pricePerAccess;
    Immutable.UnsignedInt256 internal _grantTTL;
    Immutable.Boolean internal _supportsLicensing;

    mapping(address => uint256) internal _grantTimestamps;
    mapping(address => uint256) internal _licenseTimestamps;

    /// @notice Returns non-zero value if this asset requires
    /// payment for access. Zero otherwise
    function pricePerAccess() public view afterInit returns (uint256) {
        return _pricePerAccess.value;
    }

    /// @notice Sets the price per access in wei for content backed
    /// by this contract.
    function setPricePerAccess(uint256 pricePerAccess_)
        public
        override
        nonReentrant
        onlyOwner
        afterInit
    {
        require(!_supportsLicensing.value, "SHARE019");
        _pricePerAccess.locked = false;
        Immutable.setUnsignedInt256(_pricePerAccess, pricePerAccess_);
    }

    /// @notice If called with a value equal to the price per access
    /// of this contract, records a grant timestamp on chain which is
    /// read by decentralized distribution network (DDN) microservices
    /// to decrypt and serve the associated content for the tokenURI.
    function access(uint256 tokenId, address recipient)
        external
        virtual
        payable;

    /// @notice Returns true if this PFA supports licensing, where
    /// licensing is the ability for a separate contract to forward
    /// payment to this PFA in exchange for the ability to perpetually
    /// serve the underlying content on its behalf. For example,
    /// licensing may be used to achieve transaction gated playlisting
    /// of a collection of PFAs.
    function supportsLicensing() external view afterInit returns (bool) {
        return _supportsLicensing.value;
    }

    /// @notice Returns the timestamp in seconds of the award of a
    /// grant recorded on chain for the access of the content
    /// associated with this PFA.
    function grantTimestamp(address recipient_)
        public
        override
        view
        afterInit
        returns (uint256)
    {
        return _grantTimestamps[recipient_];
    }

    /// @notice Returns the timestamp in seconds of the award of a
    /// grant recorded on chain for the access of the content
    /// associated with this PFA.
    function licenseTimestamp(address recipient_)
        external
        view
        afterInit
        returns (uint256)
    {
        return _licenseTimestamps[recipient_];
    }

    /// @notice Returns the time-to-live (TTL) in seconds of an
    /// awarded access grant for this PFA. Access to the associated
    ///content expires at `grant award timestamp + grant TTL`.
    function grantTTL() external view afterInit returns (uint256) {
        return _grantTTL.value;
    }

    /// @notice If called with a `recipient` (licensee) contract which
    /// has proof of inclusion of this PFA (licensor) address in its
    /// payout distribution table, records a license timestamp on
    /// chain which is read by decentralized distribution (DDN)
    /// microservices to decrypt and serve the associated content for
    /// the tokenURI to users who have paid to access the licensee
    /// contract.
    /// @dev Proof of inclusion is in the form of source code
    /// verification of the licensee, as well as the assertion of
    /// immutable state of the licensee contract payout distribution
    /// table. Immutable state is verified using knowledge of the
    /// keccak256 hash of the runtime bytecode of the source code
    /// for approved licensees which implement a write-once
    /// distribution address table.
    function license(address recipient_) public nonReentrant afterInit {
        require(_supportsLicensing.value, "SHARE018");
        SHARE protocol = SHARE(shareContractAddress());
        require(
            protocol.isApprovedBuild(
                recipient_,
                CodeVerification.BuildType.PFA_COLLECTION
            ),
            "SHARE000"
        );
        require(IPFACollection(recipient_).contains(address(this)), "SHARE001");
        _licenseTimestamps[recipient_] = block.timestamp;
        emit License(recipient_);
    }
}
