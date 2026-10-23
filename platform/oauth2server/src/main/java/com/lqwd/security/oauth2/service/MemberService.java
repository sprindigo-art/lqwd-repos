package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.model.security.Member;
import com.lqwd.security.oauth2.repository.MemberRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberService {

    @Autowired
    private MemberRepository memberRepository;

    @Transactional(readOnly = true)
    public Member findByMembername(String membername){
        Member member = memberRepository.findByMembername(membername);
        if (member != null) {
            return member;
        }

        throw new UsernameNotFoundException(membername);
    }
}
