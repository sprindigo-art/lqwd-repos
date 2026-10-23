const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const commonPaths = require('./paths');

module.exports = {
    mode: 'production',
    output: {
        filename: `${commonPaths.jsFolder}/[name].[hash].js`,
        path: commonPaths.outputPath,
        chunkFilename: `${commonPaths.jsFolder}/[name].[chunkhash].js`,
    },
    optimization: {
        minimize: true,
        minimizer: [

            //TODO: check terser  <4.8.1 || >=5.0.0 <5.14.2 vulnerabilty in prod (npm audit) (Severity: high) 
            //Terser insecure use of regular expressions before v4.8.1 and v5.14.2 leads to ReDoS
            //https://github.com/advisories/GHSA-4wf5-vphf-c2xc

            new TerserPlugin({
                // Use multi-process parallel running to improve the build speed
                // Default number of concurrent runs: os.cpus().length - 1
                parallel: true,
                // Enable file caching
                cache: true,
                sourceMap: false,
                terserOptions: {
                    compress: {
                        drop_console: true,
                    },
                },
            }),
            new OptimizeCSSAssetsPlugin(),
        ],
        // Automatically split vendor and commons
        // https://twitter.com/wSokra/status/969633336732905474
        // https://medium.com/webpack/webpack-4-code-splitting-chunk-graph-and-the-splitchunks-optimization-be739a861366
        splitChunks: {
            cacheGroups: {
                vendors: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'initial',
                },
                async: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'async',
                    chunks: 'async',
                    minChunks: 4,
                },
            },
        },
        // Keep the runtime chunk seperated to enable long term caching
        // https://twitter.com/wSokra/status/969679223278505985
        runtimeChunk: true,
    },

    module: {
        rules: [{
                test: /\.(js|jsx)$/,
                loader: 'babel-loader',
                exclude: /(node_modules)/,
                options: {
                    presets: ['@babel/react'],
                    plugins: [
                        ['import', { libraryName: 'antd', style: true }]
                    ],
                },
            },
            {
                test: /\.(css|scss|sass)$/,
                use: [{
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            publicPath: ''
                        }
                    },
                    {
                        loader: 'css-loader',
                        options: {
                            sourceMap: false,
                            // localsConvention: 'camelCase',
                            // modules: {
                            //   localIdentName: '[local]___[hash:base64:5]',
                            // },
                        },
                    },
                    'sass-loader',
                ],
            },
        ],
    },
    plugins: [
        new CleanWebpackPlugin(),
        new MiniCssExtractPlugin({
            filename: `${commonPaths.cssFolder}/[name].css`,
            chunkFilename: `${commonPaths.cssFolder}/[name].css`,
        }),
    ],
    devtool: 'source-map',
};