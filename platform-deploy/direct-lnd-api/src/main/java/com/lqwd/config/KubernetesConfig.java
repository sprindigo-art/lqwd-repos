package com.lqwd.config;

import com.amazonaws.util.IOUtils;
import io.fabric8.kubernetes.client.Config;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.MessageFormat;

@RefreshScope
@Component
public class KubernetesConfig {

    @Value("${app.kubernetes.config.token}")
    private String k8Token;
    @Value("${app.kubernetes.config.cert_data}")
    private String certData;


    public Config getKubernetesConfig() throws IOException {

        InputStream inputStream = getClass().getResourceAsStream("/config-kubernetes.yml");
        String kubeconfigContents = IOUtils.toString(inputStream);
        kubeconfigContents = MessageFormat.format(kubeconfigContents, certData,"{}", k8Token);


        Config config = Config.fromKubeconfig(kubeconfigContents);

        return config;
    }
}
