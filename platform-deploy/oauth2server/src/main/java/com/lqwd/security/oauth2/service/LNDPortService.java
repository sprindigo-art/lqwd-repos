package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.model.LndPort;
import com.lqwd.security.oauth2.repository.LNDPortRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class LNDPortService {


    private final LNDPortRepository lndPortRepository;
    private final Logger logger = LoggerFactory.getLogger(LNDPortService.class);


    public Page<LndPort> findAll(int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<LndPort> items = lndPortRepository.getAll(pageable);
        return items;
    }


    public void releaseLndPort(int port) {
        int p =  lndPortRepository.setPortAvailable(port);
        logger.info("LND port available value: {}", p);
    }

    @Transactional
    public Optional<LndPort> GetAvailablePort() {
        return lndPortRepository.findFirstByInUse(false);
    }

    public LndPort save(LndPort port) {
        return lndPortRepository.save(port);
    }

    public Optional<LndPort> findById(Long id) {
        return lndPortRepository.findById(id);
    }

    public LndPort save(int port, String btcHost, String lndIp) {
        LndPort p = new LndPort();

        p.setPort(port);
        p.setBtcHost(btcHost);
        p.setLndIp(lndIp);

        return lndPortRepository.save(p);
    }

    public boolean deleteById(Long id) {

        LndPort port  = findById(id).orElse(null);

        if(port == null)
            return false;

        if(port.isInUse())
            return false;

         lndPortRepository.deleteById(id);

         return true;
    }

    public List<LndPort> saveFromRange(int start, int end, String btcHost, String lndIp) {

        List<LndPort> ports = lndPortRepository.findAll();
        Map<Integer, Integer> portMap = new HashMap<>();

        for (int i = 0; i < ports.size(); i++) {
            portMap.put(ports.get(i).getPort(), i);
        }

        List<LndPort> portsToSave = new ArrayList<>();

        for (int i = start; i <= end; i++) {

            if (portMap.get(i) != null)
                continue;

            LndPort port = new LndPort();
            port.setPort(i);
            port.setBtcHost(btcHost);
            port.setLndIp(lndIp);
            portsToSave.add(port);
        }

        return lndPortRepository.saveAll(portsToSave);
    }


}
