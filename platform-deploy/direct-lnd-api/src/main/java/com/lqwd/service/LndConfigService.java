package com.lqwd.service;

import com.lqwd.model.entities.LndConfig;
import com.lqwd.repository.LndConfigRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class LndConfigService {

    private final LndConfigRepository lndConfigRepository;


    public void update(LndConfig lndConfig) {
        lndConfigRepository.save(lndConfig);
    }


}
