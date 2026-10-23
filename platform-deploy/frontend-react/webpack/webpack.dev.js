const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const commonPaths = require('./paths');

module.exports = {
    mode: 'development',
    output: {
        filename: '[name].js',
        path: commonPaths.outputPath,
        chunkFilename: '[name].js',
    },
    devtool: 'inline-source-map',
    // devtool: 'eval-source-map',
    module: {
        rules: [{
                test: /\.(js|jsx)$/,
                loader: 'babel-loader',
                exclude: /(node_modules)/,
                options: {
                    presets: ['@babel/react'],
                    plugins: [
                        ['import', { libraryName: 'antd', style: true }],
                        require.resolve('react-refresh/babel'),
                    ].filter(Boolean),
                },
            },
            {
                test: /\.(css|scss|sass)$/,
                use: [
                    'style-loader',
                    {
                        loader: 'css-loader',
                        options: {
                            sourceMap: true,
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
    devServer: {
        static: commonPaths.outputPath,
        compress: false,
        hot: true,
        historyApiFallback: true,
        proxy: {
            '/api': { target: 'http://localhost:8690', logLevel: 'debug', pathRewrite: { '^/api': '' } },
            '/billing': { target: 'http://localhost:8790', logLevel: 'debug', pathRewrite: { '^/billing': '' } },
            '/push': { target: 'http://localhost:7001', logLevel: 'debug', pathRewrite: { '^/push': '' } },
            // '/version': {
            //     bypass: (req, res) => res.send({
            //         //this will be major version + build number from jenkins
            //         version: '1.12'
            //     }),
            // },

        },
    },
    plugins: [new ReactRefreshWebpackPlugin()],
};