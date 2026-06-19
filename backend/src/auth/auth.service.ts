async registerCompany(data: RegisterCompanyDto) {
  const { companyName, cnpj, email, password } = data;

  const normalizedName = companyName.trim();
  const normalizedCnpj = cnpj.replace(/\D/g, '');

  const companyExists = await this.prisma.company.findUnique({
    where: { cnpj: normalizedCnpj },
  });

  if (companyExists) {
    throw new ConflictException('CNPJ já cadastrado.');
  }

  const userExists = await this.prisma.user.findUnique({
    where: { email },
  });

  if (userExists) {
    throw new ConflictException('Email já cadastrado.');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await this.prisma.$transaction(async (prisma) => {
    const company = await prisma.company.create({
      data: {
        name: normalizedName,
        cnpj: normalizedCnpj,
      },
    });

    const user = await prisma.user.create({
      data: {
        name: email,
        email,
        password: hashedPassword,
        companyId: company.id,
      },
    });

    return { company, user };
  });

  const payload = {
    userId: result.user.id,
    email: result.user.email,
    companyId: result.user.companyId,
  };

  const options: JwtSignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN || '1d') as any,
  };

  const { password: _, ...safeUser } = result.user;

  return {
    access_token: this.jwtService.sign(payload, options),
    user: safeUser,
    company: result.company,
  };
}