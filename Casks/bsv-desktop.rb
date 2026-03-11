cask "bsv-desktop" do
  arch arm: "arm64", intel: "x64"

  version "2.0.6"

  on_arm do
    sha256 "60e69efdc3c23218b08a247a80d508bcc853b77cdf4dbaf76b05bb18884803e9"
  end
  on_intel do
    sha256 "666f4f294730b7f5d97b667e7791e524bcec323937654da5993ca9d3a6e34217"
  end

  url "https://github.com/bsv-blockchain/bsv-desktop/releases/download/v#{version}/BSV-Desktop-#{version}-#{arch}-mac.dmg"
  name "BSV Desktop"
  desc "Cross-platform desktop wallet for the BSV blockchain"
  homepage "https://github.com/bsv-blockchain/bsv-desktop"

  livecheck do
    url :homepage
    strategy :github_latest
  end

  app "BSV-Desktop.app"

  zap trash: [
    "~/Library/Application Support/BSV-Desktop",
    "~/Library/Logs/BSV-Desktop",
    "~/Library/Preferences/com.bsvblockchain.bsvdesktop.plist",
    "~/Library/Saved Application State/com.bsvblockchain.bsvdesktop.savedState",
  ]
end
