const {
  DEFAULT_ADDRESS_INDEX,
  NON_OWNER_ADDRESS_INDEX,
  UNIT_TOKEN_INDEX,
  GRANT_TTL_PRECISION_SEC,
  LICENSE_TTL_PRECISION_SEC,
} = require("./helper");

const SHARE = artifacts.require("SHARE");
const PFAUnit = artifacts.require("PFAUnit");
const S2RD = artifacts.require("S2RD");
const CodeVerification = artifacts.require("CodeVerification");
const PFACollection = artifacts.require("PFACollection");

contract("SHARE", (accounts) => {
  specify("Contract initialization", async () => {
    const shareContract = await SHARE.deployed();
    assert.equal(accounts[DEFAULT_ADDRESS_INDEX], await shareContract.owner());
    assert.equal(await shareContract._transactionFeeNumerator.call(), 1);
    assert.equal(await shareContract._transactionFeeDenominator.call(), 20);
  });

  specify("Only owner sets transaction fee", async () => {
    const shareContract = await SHARE.new();

    try {
      await shareContract.setTransactionFee(1, 10, {
        from: accounts[NON_OWNER_ADDRESS_INDEX],
      });
    } catch (error) {
      return;
    }
    throw Error("Expected error");
  });

  specify("Owner can change transaction fee", async () => {
    const shareContract = await SHARE.new();

    try {
      await shareContract.setTransactionFee(1, 10, {
        from: accounts[DEFAULT_ADDRESS_INDEX],
      });
    } catch (error) {
      console.log(error);
      throw Error("Expected error");
    }

    assert.equal(await shareContract._transactionFeeNumerator.call(), 1);

    assert.equal(await shareContract._transactionFeeDenominator.call(), 10);
  });

  specify("Gross price per access", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );

    const transactionFee =
      (await shareContract._transactionFeeNumerator.call()).toNumber() /
      (await shareContract._transactionFeeDenominator.call()).toNumber();

    assert.equal(
      (
        await shareContract.grossPricePerAccess(
          assetContract.address,
          UNIT_TOKEN_INDEX
        )
      ).toNumber(),
      1000000000 * (1 + transactionFee)
    );
  });

  specify("Gross price per license", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.new();
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      "1000000000" /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );

    const transactionFee =
      (await shareContract._transactionFeeNumerator.call()).toNumber() /
      (await shareContract._transactionFeeDenominator.call()).toNumber();

    assert.equal(
      (
        await shareContract.grossPricePerLicense(assetContract.address)
      ).toNumber(),
      1000000000 * (1 + transactionFee)
    );
  });

  specify("Access denial", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const insufficientValueWei = "1000";
    const exceedsValueWei = "2000000000";
    let insufficientValueWeiExceptionThrown = false;
    let exceedsValueWeiExceptionThrown = false;

    try {
      await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
        from: accounts[DEFAULT_ADDRESS_INDEX],
        value: insufficientValueWei,
      });
    } catch (error) {
      insufficientValueWeiExceptionThrown = true;
    }

    try {
      await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
        from: accounts[DEFAULT_ADDRESS_INDEX],
        value: exceedsValueWei,
      });
    } catch (error) {
      exceedsValueWeiExceptionThrown = true;
    }

    assert.isTrue(
      insufficientValueWeiExceptionThrown && exceedsValueWeiExceptionThrown
    );
  });

  specify("Access grant", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(assetContract.address),
      /* codeHash = keccak256(PFA code) */ 2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
      from: accounts[NON_OWNER_ADDRESS_INDEX],
      value: "1050000000",
    });
    assert.equal(
      (
        await assetContract.getPastEvents("Grant", {
          filter: {
            recipient: accounts[NON_OWNER_ADDRESS_INDEX],
            tokenId: UNIT_TOKEN_INDEX,
          },
        })
      ).length,
      1
    );
  });

  specify("Access grant recorded on SHARE contract", async () => {
    const shareContract = await SHARE.new();
    const assetContract = await PFAUnit.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(assetContract.address),
      /* codeHash = keccak256(PFA code) */ 2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
      from: accounts[NON_OWNER_ADDRESS_INDEX],
      value: "1050000000",
    });
    const grantTimestamp = await shareContract.grantTimestamp(
      assetContract.address,
      accounts[NON_OWNER_ADDRESS_INDEX]
    );
    assert.isBelow(
      Math.abs(grantTimestamp - Math.round(Date.now() / 1000)),
      GRANT_TTL_PRECISION_SEC
    );
  });

  specify("Access grant with S2RD royalty splits", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const splitContract = await S2RD.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      /* codeHash = keccak256(empty) */ 0 /* buildType_ = WALLET  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(splitContract.address),
      /* codeHash = keccak256(S2RD code) */ 1 /* buildType_ = SPLIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(assetContract.address),
      /* codeHash = keccak256(PFA code) */ 2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    const uniformCollaborators = [
      accounts[0],
      accounts[1],
      accounts[2],
      accounts[3],
      accounts[4],
    ];
    await splitContract.initialize(
      uniformCollaborators /* addrs = 5 uniform collaborators (EOA wallets) */,
      shareContract.address /* shareContractAddress_ */
    );

    // S2RD split contract is pre-initialized with recipient addresses.
    await assetContract.transferOwnership(splitContract.address);

    for (let i = 0; i < uniformCollaborators.length; i++) {
      const recipientAddress = uniformCollaborators[i];
      await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
        from: accounts[NON_OWNER_ADDRESS_INDEX],
        value: "1050000000",
      });

      const events = await splitContract.getPastEvents("Payment", {
        filter: { recipient: recipientAddress },
      });

      const mostRecentEventIndex = events.length - 1;
      console.log(events[mostRecentEventIndex]);
      assert.equal(
        events[mostRecentEventIndex].args.addressIndex.toNumber(),
        i
      );
      assert.equal(
        events[mostRecentEventIndex].args.value.toString(),
        "1000000000"
      );
    }
  });

  specify("Access grant TTL", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
      from: accounts[NON_OWNER_ADDRESS_INDEX],
      value: "1050000000",
    });

    const grantTimestamp = await assetContract.grantTimestamp(
      accounts[NON_OWNER_ADDRESS_INDEX],
      {
        from: accounts[NON_OWNER_ADDRESS_INDEX],
      }
    );

    assert.isBelow(
      Math.abs(grantTimestamp.toString() - Math.round(Date.now() / 1000)),
      GRANT_TTL_PRECISION_SEC
    );
  });

  specify("License denial non-approved collection build", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const collectionContract = await PFACollection.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        assetContract.address
      ) /* codeHash = keccak256(PFA code) */,
      2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    try {
      await shareContract.license(
        assetContract.address /* licensor */,
        collectionContract.address /* licensee */,
        {
          from: accounts[DEFAULT_ADDRESS_INDEX],
        }
      );
      throw Error("Expected error");
    } catch (error) {
      console.log(error);
      assert(error.message.includes("SHARE000"));
    }
  });

  specify("License denial missing proof of inclusion", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const collectionContract = await PFACollection.deployed();
    const verifier = await CodeVerification.deployed();
    await collectionContract.initialize(
      [] /* addresses_ */,
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        collectionContract.address
      ) /* codeHash = keccak256(collection code) */,
      3 /* buildType_ = COLLECTION  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        assetContract.address
      ) /* codeHash = keccak256(PFA code) */,
      2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    try {
      await shareContract.license(
        assetContract.address /* licensor */,
        collectionContract.address /* licensee */,
        {
          from: accounts[DEFAULT_ADDRESS_INDEX],
        }
      );
      throw Error("Expected error");
    } catch (error) {
      assert(error.message.includes("SHARE001"));
    }
  });

  specify("Withdraw from owner", async () => {
    const shareContract = await SHARE.deployed();
    const shareContractBalancePreWithdrawal = await web3.eth.getBalance(
      shareContract.address
    );
    await shareContract.withdraw();
    assert.notEqual(shareContractBalancePreWithdrawal, 0);
    assert.equal(await web3.eth.getBalance(shareContract.address), 0);
  });

  specify("Can't withdraw from non-owner", async () => {
    const shareContract = await SHARE.deployed();
    try {
      console.log(
        await shareContract.withdraw({
          from: accounts[NON_OWNER_ADDRESS_INDEX],
        })
      );
    } catch (error) {
      return;
    }
    throw Error("Expected error");
  });
});

contract("License denial collection with price < single PFA", (accounts) => {
  specify("License grant", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const collectionContract = await PFACollection.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        assetContract.address
      ) /* codeHash = keccak256(S2RD code) */,
      2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        collectionContract.address
      ) /* codeHash = keccak256(S2RD code) */,
      3 /* buildType_ = COLLECTION  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "2000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    try {
      await collectionContract.initialize(
        [assetContract.address] /* addresses_ */,
        "/test/token/uri" /* tokenURI_ */,
        "1000000000" /* pricePerAccess (wei) */,
        300 /* grantTTL_ */,
        true /* supportsLicensing */,
        0 /* pricePerLicense_ */,
        shareContract.address /* shareContractAddress_ */
      );
      throw Error("Expected error");
    } catch (error) {
      assert(error.message.includes("SHARE015"));
    }
  });
});

contract("License denial licensing not supported", (accounts) => {
  specify("License denial licensing not supported", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const collectionContract = await PFACollection.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        assetContract.address
      ) /* codeHash = keccak256(S2RD code) */,
      2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        collectionContract.address
      ) /* codeHash = keccak256(S2RD code) */,
      3 /* buildType_ = COLLECTION  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      false /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await collectionContract.initialize(
      [] /* addresses_ */,
      "/test/token/uri" /* tokenURI_ */,
      "2000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    try {
      await shareContract.license(
        assetContract.address /* licensor */,
        collectionContract.address /* licensee */,
        {
          from: accounts[DEFAULT_ADDRESS_INDEX],
        }
      );
      throw Error("Expected error");
    } catch (error) {
      assert(error.message.includes("SHARE018"));
    }
  });
});

contract("License grant", (accounts) => {
  specify("License grant", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.deployed();
    const collectionContract = await PFACollection.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        assetContract.address
      ) /* codeHash = keccak256(S2RD code) */,
      2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(
        collectionContract.address
      ) /* codeHash = keccak256(S2RD code) */,
      3 /* buildType_ = COLLECTION  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[DEFAULT_ADDRESS_INDEX] /* authorAddress_ */
    );
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await collectionContract.initialize(
      [assetContract.address] /* addresses_ */,
      "/test/token/uri" /* tokenURI_ */,
      "2000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await shareContract.license(
      assetContract.address /* licensor */,
      collectionContract.address /* licensee */,
      {
        from: accounts[DEFAULT_ADDRESS_INDEX],
      }
    );
    assert.equal(
      (
        await assetContract.getPastEvents("License", {
          filter: {
            recipient: collectionContract.address,
          },
        })
      ).length,
      1
    );
  });

  specify("License grant with non-zero licensing cost", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.new();
    const collectionContract = await PFACollection.new();
    await shareContract.setCodeVerificationEnabled(false);

    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      99999999999 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await collectionContract.initialize(
      [assetContract.address] /* addresses_ */,
      "/test/token/uri" /* tokenURI_ */,
      "2000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      999999999999 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    const grossPricePerLicense = await shareContract.grossPricePerLicense(
      assetContract.address
    );
    await shareContract.license(
      assetContract.address /* licensor */,
      collectionContract.address /* licensee */,
      {
        from: accounts[DEFAULT_ADDRESS_INDEX],
        value: grossPricePerLicense,
      }
    );
    assert.equal(
      (
        await assetContract.getPastEvents("License", {
          filter: {
            recipient: collectionContract.address,
          },
        })
      ).length,
      1
    );
  });

  specify("License grant recorded on SHARE contract", async () => {
    const shareContract = await SHARE.new();
    const assetContract = await PFAUnit.new();
    const collectionContract = await PFACollection.new();
    await shareContract.setCodeVerificationEnabled(false);
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await collectionContract.initialize(
      [assetContract.address] /* addresses_ */,
      "/test/token/uri" /* tokenURI_ */,
      "2000000000" /* pricePerAccess (wei) */,
      300 /* grantTTL_ */,
      true /* supportsLicensing */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await shareContract.license(
      assetContract.address /* licensor */,
      collectionContract.address /* licensee */,
      {
        from: accounts[DEFAULT_ADDRESS_INDEX],
      }
    );
    assert.equal(
      (
        await assetContract.getPastEvents("License", {
          filter: {
            licensee: collectionContract.address,
          },
        })
      ).length,
      1
    );
    assert.equal(
      (
        await shareContract.getPastEvents("License", {
          filter: {
            licensee: collectionContract.address,
            licensor: assetContract.address,
          },
        })
      ).length,
      1
    );
    const licenseTimestamp = await shareContract.licenseTimestamp(
      assetContract.address,
      collectionContract.address
    );
    assert.isBelow(
      Math.abs(licenseTimestamp - Math.round(Date.now() / 1000)),
      LICENSE_TTL_PRECISION_SEC
    );
  });

  specify("License TTL", async () => {
    const assetContract = await PFAUnit.deployed();
    const collectionContract = await PFACollection.deployed();
    const licenseTimestamp = await assetContract.licenseTimestamp(
      collectionContract.address,
      {
        from: accounts[DEFAULT_ADDRESS_INDEX],
      }
    );
    assert.isBelow(
      Math.abs(licenseTimestamp.toString() - Math.round(Date.now() / 1000)),
      LICENSE_TTL_PRECISION_SEC
    );
  });

  specify("Protocol transaction count increment", async () => {
    const shareContract = await SHARE.new();
    const assetContract = await PFAUnit.deployed();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(assetContract.address),
      /* codeHash = keccak256(PFA code) */ 2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    for (let i = 0; i < 50; i++) {
      await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
        from: accounts[NON_OWNER_ADDRESS_INDEX],
        value: "1050000000",
      });
      const txCount = await shareContract._transactionCount.call();
      console.log(`tx count: ${txCount}`);
      assert.equal(txCount, i + 1);
    }
  });

  specify("Protocol transaction volume increment", async () => {
    const shareContract = await SHARE.new();
    const assetContract = await PFAUnit.new();
    const verifier = await CodeVerification.deployed();
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess_ */,
      300 /* grantTTL_ */,
      true /* supportsLicensing_ */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(assetContract.address),
      /* codeHash = keccak256(PFA code) */ 2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    for (let i = 0; i < 50; i++) {
      await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
        from: accounts[NON_OWNER_ADDRESS_INDEX],
        value: "1050000000",
      });
      const txVolume = await shareContract._transactionVolume.call();
      console.log(`tx volume: ${txVolume}`);
      assert.equal(txVolume, (i + 1) * 1050000000);
    }
  });

  specify("Access grant with 50% distribution fee enabled on PFA", async () => {
    const shareContract = await SHARE.deployed();
    const assetContract = await PFAUnit.new();
    const verifier = await CodeVerification.deployed();
    await shareContract.addApprovedBuild(
      await verifier.readCodeHash(assetContract.address),
      /* codeHash = keccak256(PFA code) */ 2 /* buildType_ = PFA_UNIT  */,
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    await assetContract.initialize(
      "/test/token/uri" /* tokenURI_ */,
      "1000000000" /* pricePerAccess_ */,
      300 /* grantTTL_ */,
      true /* supportsLicensing_ */,
      0 /* pricePerLicense_ */,
      shareContract.address /* shareContractAddress_ */
    );
    await assetContract.setDistributor(
      accounts[3],
      1 /* distributionFeeNumerator_ */,
      2 /* distributionFeeDenominator_ */,
      {
        from: accounts[DEFAULT_ADDRESS_INDEX],
      }
    );
    await shareContract.access(assetContract.address, UNIT_TOKEN_INDEX, {
      from: accounts[NON_OWNER_ADDRESS_INDEX],
      value: "1050000000",
    });
    assert.equal(
      (
        await assetContract.getPastEvents("Grant", {
          filter: {
            recipient: accounts[NON_OWNER_ADDRESS_INDEX],
            tokenId: UNIT_TOKEN_INDEX,
          },
        })
      ).length,
      1
    );
    assert.equal(
      (
        await shareContract.getPastEvents("Payment", {
          filter: {
            from: accounts[NON_OWNER_ADDRESS_INDEX],
            recipient: accounts[3],
            value: "25000000",
          },
        })
      ).length,
      1
    );
  });

  specify("addApprovedBuilds approves multiple build hashes", async () => {
    const shareContract = await SHARE.new();
    await shareContract.addApprovedBuilds(
      [
        [
          "0xad59d6d30c9ff1de09eafeb8d56fe229ed9b039438cdb2ed7a6be38ae048595c" /* codeHash = keccak256(PFA code) */,
          2 /* buildType_ = PFA_UNIT  */,
        ],
        [
          "0xb871475882c793c90bd6fdc2d769d9480fa5f6fb44d85652e18dc4173925aec8" /* codeHash = keccak256(PFA code) */,
          1 /* buildType_ = SPLIT  */,
        ],
        [
          "0x964d9e7ba0886f4f9a654256a1d8887498e7f1d65b7c57a6ad9bb47acdd73d61" /* codeHash = keccak256(PFA code) */,
          2 /* buildType_ = PFA_UNIT  */,
        ],
      ],
      "solc" /* compilerBinaryTarget_ */,
      "0.8.11+commit.d7f03943" /* compilerVersion_ */,
      accounts[NON_OWNER_ADDRESS_INDEX] /* authorAddress_ */
    );
    assert.equal(
      await shareContract.isApprovedBuildHash(
        "0xad59d6d30c9ff1de09eafeb8d56fe229ed9b039438cdb2ed7a6be38ae048595c",
        2
      ),
      true
    );
    assert.equal(
      await shareContract.isApprovedBuildHash(
        "0xb871475882c793c90bd6fdc2d769d9480fa5f6fb44d85652e18dc4173925aec8",
        1
      ),
      true
    );
    assert.equal(
      await shareContract.isApprovedBuildHash(
        "0x964d9e7ba0886f4f9a654256a1d8887498e7f1d65b7c57a6ad9bb47acdd73d61",
        2
      ),
      true
    );
  });
});
