package com.lqwd.config;

import io.fabric8.kubernetes.client.Config;
import io.fabric8.kubernetes.client.utils.IOHelpers;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.FileReader;
import java.io.IOException;

@Component
public class KubernetesConfig {

    @Value("${app.kubernetes.config.file}")
    private String configFilePath;

    private static final Logger logger = LoggerFactory.getLogger(KubernetesConfig.class);

    public Config getKubernetesConfig() throws IOException {
        String kubeconfigContents = null;
        try (FileReader reader = new FileReader(configFilePath)){
            kubeconfigContents = IOHelpers.readFully(reader);
            System.out.println(kubeconfigContents);
        } catch(IOException e) {
            logger.error("Could not load Kubernetes config file from {}",  e);

        }

        Config config = Config.fromKubeconfig(kubeconfigContents);

        return config;
    }
}
