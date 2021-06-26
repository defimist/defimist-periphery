mkdir contracts/.flattened
npx truffle-flattener contracts/DefimistRouter.sol > contracts/.flattened/DefimistRouter.sol
npx truffle-flattener contracts/libraries/DefimistLibrary.sol > contracts/.flattened/DefimistLibrary.sol
npx truffle-flattener contracts/libraries/DefimistOracleLibrary.sol > contracts/.flattened/DefimistOracleLibrary.sol
