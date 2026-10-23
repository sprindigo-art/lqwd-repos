package com.lqwd.service;

import com.lqwd.config.KubernetesConfig;
import com.lqwd.model.request.SetSecretRequest;

import io.fabric8.kubernetes.api.model.Secret;

import io.fabric8.kubernetes.client.Config;
import io.fabric8.kubernetes.client.DefaultKubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.Base64;
import java.util.Map;

@Service
public class KubenetesService {
    @Autowired
    private  KubernetesConfig kubernetesConfig;

    private KubernetesClient getKubernetesClient() throws IOException {
        Config config = kubernetesConfig.getKubernetesConfig();
        return new DefaultKubernetesClient(config);
    }

    public void setSecret(SetSecretRequest setSecretRequest) throws IOException {
        KubernetesClient client = getKubernetesClient();

        Secret secret = client.secrets()
                .inNamespace(setSecretRequest.getNamespace())
                .withName(setSecretRequest.getSecretName())
                .get();


        Map<String, String> data = secret.getData();
        data.put(setSecretRequest.getSecretKey(), Base64.getEncoder().encodeToString(setSecretRequest.getSecretValue().getBytes()));
        secret.setData(data);
        client.secrets()
                .inNamespace(setSecretRequest.getNamespace())
                .withName(setSecretRequest.getSecretName())
                .createOrReplace(secret);
    }
}
