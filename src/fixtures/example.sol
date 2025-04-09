contract Sample {
        function decodeSuffix(bytes calldata cd) internal pure returns(bytes calldata suffix, bytes calldata tokensAndAmounts, bytes calldata interaction) {

        assembly {
            let lengthOffset := sub(add(cd.offset, cd.length), 0x20)
            tokensAndAmounts.length := calldataload(lengthOffset)
            tokensAndAmounts.offset := sub(lengthOffset, tokensAndAmounts.length)
            suffix := sub(tokensAndAmounts.offset, 0x192)
            interaction.offset := add(cd.offset, 1)
            interaction.length := sub(suffix, interaction.offset)
        }
    }
}