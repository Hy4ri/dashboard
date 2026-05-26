{
  description = "Development environment for Server Status Dashboard";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, utils }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pm2
          ];

          shellHook = ''
            echo "==========================================="
            echo "  Server Dashboard Dev Environment         "
            echo "  Node.js: $(node --version)               "
            echo "==========================================="
          '';
        };
      });
}
